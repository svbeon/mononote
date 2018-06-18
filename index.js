const {app, BrowserWindow} = require('electron')
const path = require('path')

require('electron-reload')(__dirname, {
  electron: path.join(__dirname, 'node_modules', '.bin', 'electron')
})

app.on('ready', event => {
  const win = new BrowserWindow({width: 800, height: 600, icon: './monoicon.ico'})

  win.loadURL(`file://${__dirname}/html/index.html`)
})
