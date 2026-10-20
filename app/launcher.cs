using System;
using System.Collections.Generic;
using System.Collections;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Reflection;
using System.Security.Cryptography;

[assembly: AssemblyTitle("RESCUE Flight Lab")]
[assembly: AssemblyDescription("RESCUE acceptance tests and local flight panel")]
[assembly: AssemblyCompany("Saeed Nik")]
[assembly: AssemblyProduct("RESCUE Flight Lab")]
[assembly: AssemblyVersion("3.0.2.0")]

internal static class RescueLauncher {
    static readonly string Root=ResolveRoot();
    static string ResolveRoot() {
        string beside=AppDomain.CurrentDomain.BaseDirectory;
        string nested=Path.Combine(beside,"03_SITL");
        return Directory.Exists(nested)?nested:beside;
    }
    const string Url="http://127.0.0.1:8765";
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=16000000 };
    static Dictionary<string,object> Request(string path,string body=null) {
        var request=(HttpWebRequest)WebRequest.Create(Url+path);
        request.Timeout=3000;
        if(body!=null) {
            request.Method="POST";request.ContentType="application/json";
            byte[] data=Encoding.UTF8.GetBytes(body);request.ContentLength=data.Length;
            using(var stream=request.GetRequestStream())stream.Write(data,0,data.Length);
        }
        using(var response=request.GetResponse())
        using(var reader=new StreamReader(response.GetResponseStream()))
            return Json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
    }
    static void StartHidden(string file,string arguments) {
        Process.Start(new ProcessStartInfo(file,arguments) {
            WorkingDirectory=Root,UseShellExecute=false,CreateNoWindow=true,
            WindowStyle=ProcessWindowStyle.Hidden
        });
    }
    static string FindQgc() {
        foreach(string folder in new string[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","QGroundControl"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"QGroundControl"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"QGroundControl")
        }) {
            foreach(string relative in new string[] {"bin\\QGroundControl.exe","QGroundControl.exe"}) {
                string candidate=Path.Combine(folder,relative);
                if(File.Exists(candidate))return candidate;
            }
        }
        return null;
    }
    static void VerifyPackage() {
        foreach(string relative in new string[] {"runtime\\python.exe","bin\\arduplane.exe","bin\\cygwin1.dll",
            "monitor.py","monitor.html","monitor.css","monitor-ui.js","reports-ui.js","scene.js",
            "test_rescue.py","scenario_bank.py","verify_scenario.py","flight_reports.py","qgc_link.py",
            "rescue.parm","test-site.json","build-manifest.json","pydeps\\pymavlink\\mavutil.py"})
            if(!File.Exists(Path.Combine(Root,relative)))throw new FileNotFoundException("Package file is missing: "+relative);
        var manifest=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(Root,"build-manifest.json")));
        string hash;
        using(var sha=SHA256.Create())using(var input=File.OpenRead(Path.Combine(Root,"bin","arduplane.exe")))
            hash=BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();
        if(hash!=(string)manifest["binary_sha256"])throw new InvalidDataException("The SITL binary does not match its build manifest.");
        File.WriteAllText(Path.Combine(Root,"launcher-check.json"),Json.Serialize(new {
            passed=true,launcher_version="3.0.2",package_root=Root,firmware_sha256=hash,
            qgc_installed=FindQgc()!=null,checked_at=DateTime.Now.ToString("s"),
            scope="Local package files and binary hash; no service or flight was started."
        }),new UTF8Encoding(false));
    }
    static string IniValue(List<string> lines,string section,string key) {
        bool inside=false;
        foreach(string line in lines) {
            string value=line.Trim();
            if(value.StartsWith("[")) {inside=value=="["+section+"]";continue;}
            if(inside && value.StartsWith(key+"="))return value.Substring(key.Length+1);
        }
        return "";
    }
    static void IniSet(List<string> lines,string section,string key,string value) {
        int group=lines.FindIndex(s=>s.Trim()=="["+section+"]");
        if(group<0){lines.Add("");lines.Add("["+section+"]");group=lines.Count-1;}
        int end=group+1;
        while(end<lines.Count && !lines[end].TrimStart().StartsWith("["))end++;
        for(int n=end-1;n>group;n--)if(lines[n].TrimStart().StartsWith(key+"="))lines.RemoveAt(n);
        lines.Insert(group+1,key+"="+value);
    }
    static void ConfigureQgcGateway() {
        string folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"QGroundControl");
        Directory.CreateDirectory(folder);
        string path=Path.Combine(folder,"QGroundControl.ini");
        var lines=new List<string>(File.Exists(path)?File.ReadAllLines(path):new string[0]);
        if(File.Exists(path) && !File.Exists(path+".rescue-v2.backup"))File.Copy(path,path+".rescue-v2.backup");
        IniSet(lines,"AutoConnect","autoConnectPixhawk","false");
        IniSet(lines,"AutoConnect","autoConnectUDP","false");
        IniSet(lines,"General","virtualJoystick","true");
        IniSet(lines,"General","virtualJoystickAutoCenterThrottle","false");
        // QGC 5.1.5: false maps left pad to throttle/yaw and applies its
        // non-centering option there; the right attitude pad recenters.
        IniSet(lines,"General","virtualJoystickLeftHandedMode","false");
        int count=0;Int32.TryParse(IniValue(lines,"LinkConfigurations","count"),out count);
        if(count<0 || count>128)throw new InvalidOperationException("Invalid QGC link count");
        int slot=count;
        for(int i=0;i<count;i++)if(IniValue(lines,"LinkConfigurations","Link"+i+"\\name")=="RESCUE SITL"){slot=i;break;}
        string prefix="Link"+slot+"\\";
        foreach(var pair in new Dictionary<string,string>{{"name","RESCUE SITL"},{"type","1"},{"auto","true"},{"high_latency","false"},{"port","14551"},{"hostCount","1"},{"host0","127.0.0.1"},{"port0","14560"}})
            IniSet(lines,"LinkConfigurations",prefix+pair.Key,pair.Value);
        IniSet(lines,"LinkConfigurations","count",Math.Max(count,slot+1).ToString());
        File.WriteAllLines(path,lines,new UTF8Encoding(false));
    }
    [STAThread] static int Main(string[] args) {
        try {
            bool groundManual=Array.IndexOf(args,"--ground")>=0 || Path.GetFileNameWithoutExtension(Application.ExecutablePath)=="QGC-Manual-Ground";
            if(Array.IndexOf(args,"--verify-package")>=0){VerifyPackage();return 0;}
            if(Array.IndexOf(args,"--configure-qgc-only")>=0){ConfigureQgcGateway();return 0;}
            string python=Path.Combine(Root,"runtime","python.exe");
            if(!File.Exists(python))throw new FileNotFoundException("This folder is incomplete. Extract the entire RESCUE delivery ZIP, or run RESCUE-Setup.exe from the GitHub release to download and prepare it automatically.");
            VerifyPackage();
            string qgc=FindQgc();
            if(qgc==null)throw new FileNotFoundException("Install QGroundControl using installers\\QGroundControl-5.1.5-AMD64.exe, then reopen this launcher.");
            Dictionary<string,object> status=null;
            try {status=Request("/state");} catch(WebException) {}
            if(status!=null && (!status.ContainsKey("engine") || (string)status["engine"]!="ArduPlane 4.6.3 SITL"))
                throw new InvalidOperationException("Local port 8765 is occupied by another application.");
            // A new download must run its own code, rather than silently reusing
            // an older server that happens to have the same API revision.
            bool differentPackage=status!=null && (!status.ContainsKey("package_root") ||
                !String.Equals(Path.GetFullPath((string)status["package_root"]).TrimEnd('\\'),
                    Path.GetFullPath(Root).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase));
            if(differentPackage) {
                if((bool)status["running"]) {
                    var flight=status.ContainsKey("flight")?status["flight"] as Dictionary<string,object>:null;
                    if(flight!=null && flight.ContainsKey("armed") && (bool)flight["armed"])
                        throw new InvalidOperationException("Another package is flying. Finish that flight in the panel before opening this delivery.");
                    Request("/stop","{}");
                    for(int n=0;n<120 && (bool)status["running"];n++){Thread.Sleep(250);status=Request("/state");}
                    if((bool)status["running"])throw new InvalidOperationException("The older ground session did not stop.");
                }
                Request("/shutdown","{}");status=null;
                for(int n=0;n<40;n++) {
                    Thread.Sleep(250);
                    try {Request("/state");} catch(WebException) {break;}
                    if(n==39)throw new InvalidOperationException("The older local service did not close.");
                }
            }
            if(groundManual && status!=null && (bool)status["running"]) {
                Request("/stop","{}");
                for(int n=0;n<120 && (bool)status["running"];n++){Thread.Sleep(250);status=Request("/state");}
                if((bool)status["running"])throw new InvalidOperationException("The previous simulation did not stop.");
            }
            if(status==null) {
                StartHidden(python,"-u \""+Path.Combine(Root,"monitor.py")+"\" --background");
                for(int n=0;n<60 && status==null;n++) {
                    Thread.Sleep(250);
                    try {status=Request("/state");} catch(WebException) {}
                }
                if(status==null)throw new InvalidOperationException("The local server did not start. See server.log in the application folder.");
            }
            if(Process.GetProcessesByName("QGroundControl").Length==0) {
                ConfigureQgcGateway();
                Process.Start(new ProcessStartInfo(qgc) { WorkingDirectory=Path.GetDirectoryName(qgc),UseShellExecute=false });
            }
            Request("/source","{\"source\":\"sitl\"}");
            if(!(bool)status["running"])Request(groundManual?"/start-ground":"/start","{\"altitude\":240,\"speedup\":1}");
            status=Request("/state");
            if((string)status["source"]=="sitl")Request("/qgc/reconnect","{}");
            if(!groundManual)Process.Start(new ProcessStartInfo(Url+"/") { UseShellExecute=true });
            File.AppendAllText(Path.Combine(Root,"launcher.log"),DateTime.Now.ToString("s")+" Opened SITL tests"+Environment.NewLine);
            return 0;
        } catch(Exception error) {
            File.AppendAllText(Path.Combine(Root,"launcher.log"),DateTime.Now.ToString("s")+" "+error+Environment.NewLine);
            if(Array.IndexOf(args,"--verify-package")<0)
                MessageBox.Show(error.Message,"RESCUE Flight Lab",MessageBoxButtons.OK,MessageBoxIcon.Error);
            return 1;
        }
    }
}
