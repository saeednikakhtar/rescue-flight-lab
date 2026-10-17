"""Persistent loopback MAVLink transport for PC SITL and QGroundControl.

Keep the GCS-facing UDP source port stable across aircraft restarts. Forward
original vehicle bytes only; never invent an autopilot heartbeat or replay a
stopped flight. This path cannot reach the optional physical USB controller.
"""
import csv
import io
import json
import os
from pathlib import Path
import select
import socket
import subprocess
import threading
import time

from pymavlink.dialects.v20 import ardupilotmega as wire


class QGCLink:
    def __init__(self, root, vehicle_port=14555, local_port=14560, qgc_port=14551):
        self.root = Path(root)
        self.vehicle_port, self.local_port, self.qgc_port = vehicle_port, local_port, qgc_port
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.thread = None
        self.vehicle_socket = self.gcs_socket = None
        self.peer = None
        self.session = None
        self.active = False
        self.vehicle_hb = self.gcs_hb = None
        self.vehicle_rx = self.gcs_rx = 0
        self.reconnect_count = 0
        self.forwarded_frames = 0
        self.error = self.app_error = None
        self.opening = False
        self._last_status = None
        self.last_vehicle_heartbeat = None
        self.last_position = None
        self.last_gcs_heartbeat = None
        self.vehicle_types = {}
        self.gcs_types = {}
        self.pilot_input_at = 0
        self.pilot_input = None
        self.block_pilot = False
        self.blocked_inputs = 0
        self.handover_seconds = 5.0
        self.decoder_v = wire.MAVLink(None)
        self.decoder_g = wire.MAVLink(None)
        self.decoder_v.robust_parsing = self.decoder_g.robust_parsing = True
        self.encoder = wire.MAVLink(None, srcSystem=254, srcComponent=191)

    def event(self, kind, **values):
        row = dict(event=kind, wall_time=time.time(), session=self.session, **values)
        with (self.root/'qgc-link-events.jsonl').open('a', encoding='utf-8') as out:
            out.write(json.dumps(row, separators=(',', ':'))+'\n')

    @staticmethod
    def udp(port):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            # Ignore Windows UDP ICMP errors when QGC has not opened yet.
            if hasattr(socket, 'SIO_UDP_CONNRESET'):
                sock.ioctl(socket.SIO_UDP_CONNRESET, False)
            sock.bind(('127.0.0.1', port))
            sock.setblocking(False)
            return sock
        except Exception:
            sock.close()
            raise

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive():
                return
            self.stop.clear()
            try:
                self.vehicle_socket = self.udp(self.vehicle_port)
                self.vehicle_port = self.vehicle_socket.getsockname()[1]
                self.gcs_socket = self.udp(self.local_port)
                self.local_port = self.gcs_socket.getsockname()[1]
                self.error = None
            except OSError as exc:
                for sock in (self.vehicle_socket, self.gcs_socket):
                    if sock:
                        sock.close()
                self.vehicle_socket = self.gcs_socket = None
                self.error = str(exc)
                raise
            self.thread = threading.Thread(target=self.worker, daemon=True)
            self.thread.start()
            self.event('relay_started', input_port=self.vehicle_port, stable_gcs_port=self.local_port)

    def begin_session(self, session):
        with self.lock:
            self.active = True
            self.session = session
            self.peer = None
            self.vehicle_hb = None
            self.last_vehicle_heartbeat = self.last_position = None
            self.handover_seconds = 5.0
            # A new process starts a new byte stream. Retired partial frames
            # must not be combined with the next aircraft's first frame.
            self.decoder_v = wire.MAVLink(None)
            self.decoder_v.robust_parsing = True
            # Clear any queued datagrams from the retired aircraft process.
            while self.vehicle_socket:
                try:
                    self.vehicle_socket.recvfrom(65535)
                except (BlockingIOError, ConnectionResetError):
                    break
            self.event('flight_started')

    def end_session(self):
        with self.lock:
            self.active = False
            self.peer = None
            self.vehicle_hb = None
            self.event('flight_stopped')

    def snapshot(self):
        with self.lock:
            now = time.monotonic()
            age_g = None if self.gcs_hb is None else round(max(0, now-self.gcs_hb), 3)
            age_v = None if self.vehicle_hb is None else round(max(0, now-self.vehicle_hb), 3)
            gcs_alive = age_g is not None and age_g < 4
            vehicle_alive = age_v is not None and age_v < 4
            connected = self.active and gcs_alive and vehicle_alive
            status = ('error' if self.error else 'idle' if not self.active else
                      'connected' if connected else 'reconnecting' if self.gcs_hb is not None else 'waiting')
            return dict(state=status, connected=connected, gcs_alive=gcs_alive,
                        vehicle_alive=vehicle_alive, last_heartbeat_age_s=age_g,
                        vehicle_heartbeat_age_s=age_v, vehicle_rx_packets=self.vehicle_rx,
                        gcs_rx_packets=self.gcs_rx, reconnect_count=self.reconnect_count,
                        forwarded_frames=self.forwarded_frames,
                        error=self.error, app_error=self.app_error, opening=self.opening,
                        local_port=self.local_port, input_port=self.vehicle_port,qgc_port=self.qgc_port,
                        vehicle_peer_port=None if self.peer is None else self.peer[1],
                        session_id=self.session, scope='PC SITL only',
                        vehicle_heartbeat=self.last_vehicle_heartbeat,
                        vehicle_position=self.last_position,
                        gcs_heartbeat=self.last_gcs_heartbeat,
                        vehicle_message_counts=self.vehicle_types.copy(),
                        gcs_message_counts=self.gcs_types.copy(),
                        pilot_input=self.pilot_input,
                        pilot_input_age_s=None if not self.pilot_input_at else round(now-self.pilot_input_at,3),
                        pilot_input_blocked=self.block_pilot,blocked_input_frames=self.blocked_inputs)

    def _request_live_telemetry(self):
        if not self.active or self.peer is None:
            return
        packets = [self.encoder.request_data_stream_encode(2, 1, wire.MAV_DATA_STREAM_ALL, 10, 1)]
        for message_id in (148, 33, 30):
            packets.append(self.encoder.command_long_encode(2, 1, 512, 0,
                                                           message_id, 0, 0, 0, 0, 0, 0))
        for message in packets:
            data = message.pack(self.encoder)
            self.encoder.seq = (self.encoder.seq+1) % 256
            self.vehicle_socket.sendto(data, self.peer)

    def reconnect(self, open_app=True):
        self.start()
        with self.lock:
            self.reconnect_count += 1
            # Keep both bound ports. Ask the actual running aircraft for fresh
            # telemetry, rather than manufacturing or replaying vehicle data.
            self._request_live_telemetry()
            self.event('reconnect_requested', count=self.reconnect_count)
        if open_app:
            self.open_qgc()

    def open_qgc(self):
        with self.lock:
            if self.opening:
                return
            self.opening = True
        threading.Thread(target=self._open_qgc_worker, daemon=True).start()

    def _open_qgc_worker(self):
        try:
            flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            listing = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq QGroundControl.exe',
                                      '/FO', 'CSV', '/NH'], capture_output=True, text=True,
                                     timeout=5, creationflags=flags)
            running = any(row and row[0].lower() == 'qgroundcontrol.exe'
                          for row in csv.reader(io.StringIO(listing.stdout)))
            if not running:
                exe = Path(os.environ['LOCALAPPDATA'])/'Programs/QGroundControl/bin/QGroundControl.exe'
                if not exe.is_file():
                    raise FileNotFoundError('QGroundControl is not installed in the prepared user directory.')
                subprocess.run([str(self.root/'RESCUE-Flight-Lab.exe'),'--configure-qgc-only'],check=True,timeout=10,creationflags=flags)
                subprocess.Popen([str(exe)], cwd=exe.parent)
            with self.lock:
                self.app_error = None
                self.event('qgc_open', reused=running)
        except Exception as exc:
            with self.lock:
                self.app_error = str(exc)
        finally:
            with self.lock:
                self.opening = False

    def worker(self):
        last_watchdog = 0
        while not self.stop.is_set():
            try:
                ready, _, _ = select.select([self.vehicle_socket, self.gcs_socket], [], [], .1)
                for sock in ready:
                    try:
                        data, peer = sock.recvfrom(65535)
                    except (BlockingIOError, ConnectionResetError):
                        continue
                    if peer[0] != '127.0.0.1':
                        continue
                    with self.lock:
                        if sock is self.vehicle_socket:
                            if not self.active:
                                continue
                            messages = self.decoder_v.parse_buffer(data) or []
                            # Preserve newer wire messages (e.g. AVAILABLE_MODES)
                            # even when this Python dialect does not know their CRC.
                            header_sysid = (data[5] if len(data)>=12 and data[0]==253 else
                                            data[3] if len(data)>=8 and data[0]==254 else None)
                            valid = self.peer == peer or header_sysid == 2 or any(m.get_type() != 'BAD_DATA' and m.get_srcSystem() == 2 for m in messages)
                            if not valid:
                                continue
                            new_peer = self.peer != peer
                            self.peer = peer
                            self.vehicle_rx += 1
                            for message in messages:
                                typ = message.get_type()
                                self.vehicle_types[typ] = self.vehicle_types.get(typ, 0)+1
                                if typ == 'HEARTBEAT' and message.get_srcSystem() == 2 and message.type != wire.MAV_TYPE_GCS:
                                    self.vehicle_hb = time.monotonic()
                                    self.last_vehicle_heartbeat = dict(system=message.get_srcSystem(), component=message.get_srcComponent(), mode=message.custom_mode, armed=bool(message.base_mode & 128), wire_magic=data[0])
                                elif typ == 'GLOBAL_POSITION_INT' and message.get_srcSystem() == 2:
                                    self.last_position = dict(time_boot_ms=message.time_boot_ms, lat=message.lat/1e7, lon=message.lon/1e7, altitude_home_m=message.relative_alt/1000)
                                elif typ == 'PARAM_VALUE' and message.get_srcSystem() == 2:
                                    name=message.param_id.decode().rstrip('\0') if isinstance(message.param_id,bytes) else str(message.param_id).rstrip('\0')
                                    if name=='RSC_HAND_S' and .5<=message.param_value<=60:
                                        self.handover_seconds=float(message.param_value)
                            if new_peer:
                                self._request_live_telemetry()
                                self.event('aircraft_discovered', peer_port=peer[1])
                            # A UDP chunk is not a semantic message boundary.
                            # Forward complete original frames, including newer
                            # unknown message IDs, without dropping continuations
                            # or leaking routed GCS heartbeats into QGC's vehicle.
                            for message in messages:
                                frame = bytes(message.get_msgbuf())
                                # UNKNOWN messages retain their original frame,
                                # but this dialect leaves their decoded header
                                # at sysid=0. Read the original wire header so
                                # newer AVAILABLE_MODES messages reach QGC too.
                                source = (frame[5] if len(frame) >= 12 and frame[0] == 253 else
                                          frame[3] if len(frame) >= 8 and frame[0] == 254 else None)
                                if message.get_type() == 'BAD_DATA' or source != 2:
                                    continue
                                try:
                                    self.gcs_socket.sendto(frame, ('127.0.0.1', self.qgc_port))
                                    self.forwarded_frames += 1
                                except ConnectionResetError:
                                    pass
                        else:
                            self.gcs_rx += 1
                            messages = self.decoder_g.parse_buffer(data) or []
                            for message in messages:
                                typ = message.get_type()
                                self.gcs_types[typ] = self.gcs_types.get(typ, 0)+1
                                own = message.get_srcSystem() == 254 or (message.get_srcSystem() == 255 and message.get_srcComponent() == 191)
                                if typ in ('MANUAL_CONTROL','RC_CHANNELS_OVERRIDE') and not own and message.get_srcSystem()==255:
                                    target = message.target if typ=='MANUAL_CONTROL' else message.target_system
                                    if target==2 and not self.block_pilot:
                                        self.pilot_input_at=time.monotonic()
                                        self.pilot_input=dict(kind=typ,system=message.get_srcSystem(),component=message.get_srcComponent())
                                if typ == 'HEARTBEAT' and message.type == wire.MAV_TYPE_GCS and not own:
                                    self.gcs_hb = time.monotonic()
                                    self.last_gcs_heartbeat = dict(system=message.get_srcSystem(), component=message.get_srcComponent())
                            if self.active and self.peer:
                                frames=[]
                                for message in messages:
                                    if self.block_pilot and message.get_type() in ('MANUAL_CONTROL','RC_CHANNELS_OVERRIDE'):
                                        self.blocked_inputs+=1
                                    elif message.get_type()!='BAD_DATA':frames.append(bytes(message.get_msgbuf()))
                                if frames:self.vehicle_socket.sendto(b''.join(frames), self.peer)
                if time.monotonic()-last_watchdog > .5:
                    last_watchdog = time.monotonic()
                    status = self.snapshot()['state']
                    if status != self._last_status:
                        self.event('state', state=status)
                        self._last_status = status
            except (OSError, ValueError) as exc:
                if not self.stop.is_set():
                    with self.lock:
                        self.error = str(exc)
                    time.sleep(.1)

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=2)
        for sock in (self.vehicle_socket, self.gcs_socket):
            if sock:
                sock.close()
