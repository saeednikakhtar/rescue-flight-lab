using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("RESCUE Flight Lab Setup")]
[assembly: AssemblyCompany("Saeed Nik")]
[assembly: AssemblyProduct("RESCUE Flight Lab")]
[assembly: AssemblyVersion("3.0.2.0")]

internal sealed class RescueSetup : Form {
    const string ArchiveName="RESCUE-Delivery-English-3.0.2-20261020.zip";
    const string FolderName="RESCUE-Delivery-English-3.0.2-20261020";
    const string ExpectedSha256="2ccff4278762219e320f20ab807aabd986df4311a69d3b6081b3a88d8211bdf2";
    const string DownloadUrl="https://github.com/saeednikakhtar/rescue-flight-lab/releases/download/v3.0.2/"+ArchiveName;
    readonly Label message=new Label { Left=24,Top=24,Width=510,Height=48 };
    readonly ProgressBar progress=new ProgressBar { Left=24,Top=82,Width=510,Height=24 };
    readonly string destination;
    readonly bool manual,prepareOnly;
    bool completed;
    int exitCode=1;
    string logPath;

    RescueSetup(string[] args) {
        Text="RESCUE Flight Lab | Prepare Windows runtime";
        ClientSize=new System.Drawing.Size(558,138);
        FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;
        StartPosition=FormStartPosition.CenterScreen;
        Controls.Add(message);Controls.Add(progress);
        manual=Array.IndexOf(args,"--ground")>=0 || Path.GetFileNameWithoutExtension(Application.ExecutablePath)=="QGC-Manual-Ground";
        prepareOnly=Array.IndexOf(args,"--prepare-only")>=0;
        destination=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"RESCUEFlightLab","Packages");
        int destArg=Array.IndexOf(args,"--destination");
        if(destArg>=0 && destArg+1<args.Length)destination=Path.GetFullPath(args[destArg+1]);
        Shown+=async (sender,e)=>await Prepare();
        FormClosing+=(sender,e)=>{if(!completed)e.Cancel=true;};
    }
    void Status(string text,int percent=-1) {
        if(InvokeRequired){BeginInvoke(new Action(()=>Status(text,percent)));return;}
        message.Text=text;
        progress.Style=percent<0?ProgressBarStyle.Marquee:ProgressBarStyle.Continuous;
        if(percent>=0)progress.Value=Math.Min(100,Math.Max(0,percent));
    }
    void Log(string text) {File.AppendAllText(logPath,DateTime.Now.ToString("s")+" "+text+Environment.NewLine,new UTF8Encoding(false));}
    static string Hash(string path) {
        using(var sha=SHA256.Create())using(var stream=File.OpenRead(path))
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
    }
    static bool Preflight(string root) {
        string exe=Path.Combine(root,"03_SITL","RESCUE-Flight-Lab.exe");
        if(!File.Exists(exe))return false;
        using(var process=Process.Start(new ProcessStartInfo(exe,"--verify-package") {
            WorkingDirectory=Path.GetDirectoryName(exe),UseShellExecute=false,CreateNoWindow=true
        })) {
            if(!process.WaitForExit(30000))throw new TimeoutException("The package check did not finish. See launcher.log.");
            return process.ExitCode==0;
        }
    }
    void Extract(string archive,string target) {
        using(var zip=ZipFile.OpenRead(archive)) {
            int count=0;
            string boundary=Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            foreach(var entry in zip.Entries) {
                string path=Path.GetFullPath(Path.Combine(target,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
                if(!path.StartsWith(boundary,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Unsafe archive path.");
                if(String.IsNullOrEmpty(entry.Name)){Directory.CreateDirectory(path);continue;}
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                entry.ExtractToFile(path,true);
                if(++count%50==0)Status("Extracting the simulator, Python and documentation...",count*100/zip.Entries.Count);
            }
        }
    }
    static bool QgcInstalled() {
        foreach(string folder in new string[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","QGroundControl"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"QGroundControl"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"QGroundControl")
        })if(File.Exists(Path.Combine(folder,"bin","QGroundControl.exe")) || File.Exists(Path.Combine(folder,"QGroundControl.exe")))return true;
        return false;
    }
    async Task Prepare() {
        try {
            Directory.CreateDirectory(destination);
            logPath=Path.Combine(destination,"setup-3.0.2.log");
            string root=Path.Combine(destination,FolderName);
            string archive=Path.Combine(destination,ArchiveName);
            Log("Started. Destination: "+root);
            Status("Checking the complete Windows runtime...");
            if(!await Task.Run(()=>Preflight(root))) {
                bool valid=File.Exists(archive) && await Task.Run(()=>Hash(archive)==ExpectedSha256);
                if(!valid) {
                    string partial=archive+".partial";
                    ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
                    using(var client=new WebClient()) {
                        client.Headers[HttpRequestHeader.UserAgent]="RESCUE-Flight-Lab-Setup/3.0.2";
                        client.DownloadProgressChanged+=(sender,e)=>Status("Downloading the complete delivery: "+(e.BytesReceived/1048576)+" MB"+(e.TotalBytesToReceive>0?" / "+(e.TotalBytesToReceive/1048576)+" MB":""),e.ProgressPercentage);
                        Log("Download: "+DownloadUrl);
                        await client.DownloadFileTaskAsync(new Uri(DownloadUrl),partial);
                    }
                    Status("Checking SHA-256 of the downloaded delivery...");
                    if(!await Task.Run(()=>Hash(partial)==ExpectedSha256))throw new InvalidDataException("The download checksum is incorrect. Run setup again to retry the complete download.");
                    if(File.Exists(archive))File.Delete(archive);
                    File.Move(partial,archive);
                }
                Log("Downloaded archive SHA-256 verified: "+ExpectedSha256);
                Status("Extracting the complete delivery...");
                await Task.Run(()=>Extract(archive,destination));
                if(!await Task.Run(()=>Preflight(root)))throw new InvalidDataException("The extracted package is incomplete. See 03_SITL/launcher.log.");
            }
            Log("Package preflight passed: "+root);
            File.WriteAllText(Path.Combine(destination,"prepared-3.0.2.txt"),root+Environment.NewLine+ExpectedSha256+Environment.NewLine,new UTF8Encoding(false));
            if(!prepareOnly) {
                if(!QgcInstalled()) {
                    Status("Install QGroundControl in the installer window, then return here.");
                    string installer=Path.Combine(root,"03_SITL","installers","QGroundControl-5.1.5-AMD64.exe");
                    using(var install=Process.Start(new ProcessStartInfo(installer){UseShellExecute=true}))
                        await Task.Run(()=>install.WaitForExit());
                    if(!QgcInstalled())throw new InvalidOperationException("QGroundControl installation was not completed. The delivery is ready; install QGC and reopen setup.");
                }
                string launcher=Path.Combine(root,manual?"QGC-Manual-Ground.exe":"RESCUE-Flight-Lab.exe");
                Status("Opening the simulator and QGroundControl...");
                using(var launch=Process.Start(new ProcessStartInfo(launcher){WorkingDirectory=root,UseShellExecute=false})) {
                    await Task.Run(()=>launch.WaitForExit());
                    if(launch.ExitCode!=0)throw new InvalidOperationException("The simulator did not open. See 03_SITL/launcher.log in "+root);
                }
            }
            Log(prepareOnly?"Preparation complete; no flight started.":"Application launched successfully.");
            exitCode=0;
        } catch(Exception error) {
            if(logPath!=null)Log(error.ToString());
            MessageBox.Show(error.Message+"\n\nRelease: https://github.com/saeednikakhtar/rescue-flight-lab/releases/tag/v3.0.2","RESCUE setup",MessageBoxButtons.OK,MessageBoxIcon.Error);
        } finally {completed=true;Close();}
    }
    [STAThread] static int Main(string[] args) {
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        using(var window=new RescueSetup(args)){Application.Run(window);return window.exitCode;}
    }
}
