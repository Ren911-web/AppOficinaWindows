const { app, BrowserWindow, ipcMain, shell, clipboard, nativeImage } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const http = require('http');

let serverProcess;
const port = Number(process.env.PORT || 4173);
function waitForServer(){return new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{const req=http.get(`http://127.0.0.1:${port}/api/session`,res=>{res.resume();resolve()});req.on('error',()=>{if(Date.now()-start>15000)reject(new Error('El servidor de AppOficina no inició'));else setTimeout(check,250)});req.setTimeout(1000,()=>req.destroy())};check()})}
function runNetsh(args){return new Promise(resolve=>execFile('netsh.exe',args,{windowsHide:true,encoding:'utf8'},(error,stdout,stderr)=>resolve({error,stdout:String(stdout||''),stderr:String(stderr||'')})))}
async function networkStatus(){const r=await runNetsh(['wlan','show','interfaces']);const match=r.stdout.match(/SSID\s*:\s*(.+)/i);return {ssid:match?match[1].trim():'',message:r.error?'No se pudo consultar la WiFi.':'OK'}}
async function connectBackup(){const r=await runNetsh(['wlan','connect','name=Takego']);return {ok:!r.error,message:r.error?'Windows no pudo conectarse a Takego.':'Solicitud de conexión a Takego enviada.'}}
function createWindow(){const win=new BrowserWindow({width:1440,height:920,minWidth:1100,minHeight:700,backgroundColor:'#f5f7fa',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}});win.loadURL(`http://127.0.0.1:${port}`);win.webContents.setWindowOpenHandler(({url})=>{shell.openExternal(url);return {action:'deny'}});}
app.whenReady().then(async()=>{const dataDir=path.join(app.getPath('userData'),'data');serverProcess=spawn(process.execPath,[path.join(__dirname,'server.js')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PORT:String(port),APPOFICINA_DATA_DIR:dataDir},windowsHide:true,stdio:'ignore'});try{await waitForServer();createWindow()}catch(error){console.error(error);app.quit()}});
ipcMain.handle('network-status',networkStatus);ipcMain.handle('network-connect-backup',connectBackup);ipcMain.handle('share-photo',(event,{dataUrl})=>{try{const image=nativeImage.createFromDataURL(String(dataUrl||''));if(image.isEmpty())throw new Error('Imagen vacía');clipboard.writeImage(image);return{ok:true}}catch(error){return{ok:false,error:error.message}}});
app.on('window-all-closed',()=>{if(serverProcess)serverProcess.kill();if(process.platform!=='darwin')app.quit()});
