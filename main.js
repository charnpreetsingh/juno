/* Copyright 2015-2016 Robert Schroll
 *
 * This file is part of Juno and is distributed under the terms of the
 * BSD license. See the file LICENSE for full details.
 *
 * This file derives from the Electron Quick STart example
 * (https://github.com/atom/electron-quick-start), which is in the
 * public domain.
 */
'use strict';
const electron = require('electron');
const app = electron.app;  // Module to control application life.
const BrowserWindow = electron.BrowserWindow;  // Module to create native browser window.
const Menu = electron.Menu;
const ipcMain = electron.ipcMain;
const dialog = electron.dialog;
const spawn = require('child_process').spawn;
const path = require('path');
const fs = require('fs');

let configFile = null;
try {
  configFile = path.join(app.getPath('userData'), 'config.json')
} catch (err) {
  console.log(err);
}

function loadSettings() {
  let settings = {};
  if (configFile) {
    try {
      settings = JSON.parse(fs.readFileSync(configFile));
    } catch (err) {
      // pass
    }
  }
  return {
    sources: settings.sources || [],
  }
}
global.settings = loadSettings();

function saveSettings() {
  if (configFile)
    fs.writeFile(configFile, JSON.stringify(global.settings), function (err) {
      if (err)
        console.log(err);
    });
}

// Report crashes to our server.
//electron.crashReporter.start();

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let windows = [];

// Quit when all windows are closed.
app.on('window-all-closed', function() {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform != 'darwin') {
    app.quit();
  }
});

let certificates = {};
app.on('certificate-error', function(event, webContents, url, error, certificate, callback) {
  let host = url.match(/[a-z]*:\/\/([^\/]*)/)[1];
  let certText = certificate.data.toString();
  if (certificates[host] == certText) {
    event.preventDefault();
    callback(true);
    return;
  }

  console.log(url);
  let buttons = ["Continue", "Abort"];
  let window = BrowserWindow.fromWebContents(webContents);
  let details =  + (error == "net::ERR_CERT_AUTHORITY_INVALID") ?
    "If you were expecting a self-signed certificate, this is probably a false alarm." :
    "This may be a sign of a man-in-the-middle attack.";
  let message = `Juno encountered a certificate error when connecting to ${host}, for a certificate claiming to be issued by ${certificate.issuerName}.  The error was

${error}

${details}`;

  let response = dialog.showMessageBox(window, {
    "type": "warning",
    "buttons": buttons,
    "title": "Certificate Error",
    "message": "Certificate Error",
    "detail": message,
    "cancelId": buttons.indexOf("Abort")
  });
  if (buttons[response] == "Continue") {
    event.preventDefault();
    callback(true);
    certificates[host] = certText;
  } else {
    callback(false);
    webContents.send("set-host", null, null);
    for (let i in windows) {
      if (windows[i].window == window) {
        windows[i].host = null;
        windows[i].path = null;
      }
    }
  }
});

ipcMain.on('open-host', function (event, arg) {
  openNotebook(arg);
});

ipcMain.on('open-dialog', function (event) {
  openDialog(BrowserWindow.fromWebContents(event.sender));
});

function openConnectDialog() {
  for (let i in windows) {
    let win = windows[i];
    if (win.host == 'open-dialog') {
      win.window.show();
      return true;
    }
  }

  let window = createWindow();
  window.host = 'open-dialog';
  window.window.loadURL(`file://${__dirname}/connect.html`);

  let webContents = window.window.webContents;
  function sendToClient() {
    webContents.send('set-sources', global.settings.sources);
  }
  if (webContents.isLoading())
    webContents.on('did-finish-load', sendToClient);
  else
    sendToClient();

  return true;
}

function closeConnectDialog(source) {
  let index = global.settings.sources.indexOf(source);
  if (index != -1)
    global.settings.sources.splice(index, 1);
  global.settings.sources.splice(0, 0, source);
  saveSettings();

  for (let i in windows) {
    let win = windows[i];
    if (win.host == 'open-dialog') {
      win.window.close();
      return;
    }
  }
}

function openNotebook(resource) {
  let host = resource;
  let localPath = null;

  if (!resource)
    return openConnectDialog();

  // Check if the resource is a path, not a URL
  if (resource.indexOf("://") == -1) {
    let info;
    localPath = path.resolve(resource);
    host = null;
    try {
      info = fs.statSync(localPath);
    } catch (e) {
      console.log("Could not stat path: " + localPath);
      return false;
    }
    if (!info.isDirectory())
      localPath = path.dirname(localPath);  // TODO: Save filename and open it in notebook
  } else {
    // Normalize trailing slash
    if (host.slice(-1) != "/")
      host += "/";
  }

  // See if any existing window matches the host or path, whichever is requested
  for (let i in windows) {
    let win = windows[i];
    if (host && host == win.host || localPath && localPath == win.path) {
      // Focus the window
      win.window.show();
      closeConnectDialog(resource);
      return true;
    }
  }

  let window = createWindow();

  function setHost(host, path) {
    window.host = host;
    // window.path set earlier, since we want that done ASAP
    window.window.loadURL(host);
    // We have to delay this to here, to avoid a crash.  (Don't know why.)
    closeConnectDialog(resource);
  }

  // If the window doesn't have the notebook open, open it.
  if (localPath && !window.path) {
    console.log("Opening notebook server in " + localPath);
    window.path = localPath;
    let urlFound = false;
    let proc = spawn('jupyter', ['lab', '--no-browser'], {'cwd': localPath});
    window.server = proc;
    proc.stdout.on('data', function (data) { console.log("Stdout:", data.toString()); });
    proc.stderr.on('data', function (data) {
      console.log("Server:", data.toString());
      if (!urlFound) {
        let url = data.toString().match(/https?:\/\/localhost:[0-9]*\//);
        if (url) {
          urlFound = true;
          setHost(url[0], localPath);
        }
      }
    });
    proc.on('close', function (code, signal) {
      console.log("Server process ended.");
      window.server = null;
    });
  } else if (!window.host) {
    setHost(host, localPath);
  }

  // Focus the window.
  window.window.show();
  return true;
}

function createWindow() {
  // Create the browser window.
  let window = {
    "window": new BrowserWindow({width: 800, height: 600}),
    "host": null,
    "path": null,
    "server": null
  };

  // and load the index.html of the app.
  //window.window.loadURL(`file://${__dirname}/index.html`);

  // Emitted when the window is closed.
  window.window.on('closed', function() {
    if (window.server)
      window.server.kill()

    // Dereference the window object.
    let index = windows.indexOf(window);
    if (index != -1)
      windows.splice(index, 1);
    else
      console.log("Couldn't find that window!");
  });

  windows.push(window);
  return window;
}

function openDialog(parent) {
  dialog.showOpenDialog(parent, {"properties": ["openDirectory"]},
                        function (filenames) {
                          if (filenames)
                            openNotebook(filenames[0]);
                        });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', function() {
  let template = [
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: function(item, focusedWindow) {
            openNotebook(null);
          }
        },
        {
          label: "Open Directory",
          accelerator: "CmdOrCtrl+O",
          click: function(item, focusedWindow) {
            openDialog(focusedWindow);
          }
        }
      ]
    },
    {
      label: "Debug",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: function(item, focusedWindow) {
            if (focusedWindow)
              focusedWindow.reload();
          }
        },
        {
          label: "Toggle Developer Tools",
          accelerator: "CmdOrCtrl+Shift+I",
          click: function(item, focusedWindow) {
            if(focusedWindow)
              focusedWindow.webContents.toggleDevTools();
          }
        },
        {
          label: "Toggle Developer Tools for Current Notebook",
          accelerator: "Alt+Shift+I",
          click: function(item, focusedWindow) {
            if (focusedWindow)
              focusedWindow.webContents.send('toggle-dev-tools');
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  let host = process.argv[2];
  if (!openNotebook(host)) {
    console.log("Error: Could not open notebook", host);
    app.exit(1);
  }
});
