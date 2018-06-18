/* global confirm */

const fs = require('fs')
const path = require('path')
const {remote} = require('electron')
const chokidar = require('chokidar')
const moment = require('moment')
const wordcount = require('wordcount')
const Fuse = require('fuse.js')
const open = require('open')
const InscrybMDE = require('./../node_modules/inscrybmde/dist/inscrybmde.min.js')

const browser = document.getElementById('notes')
const htreg = /#[^\s].[^#\n]+/g
const nrreg = /^#+\s/

let dir = window.localStorage.getItem('dir') || path.join(remote.app.getPath('userData'), 'notes')
let notes = []
let folders = []
let currentNote
let currentFolder
let currentSearch
let counter = 0
let watcher
let mde = new InscrybMDE({
  element: document.getElementById('editarea'),
  spellChecker: false,
  toolbar: [
    {
      name: 'bold',
      action: InscrybMDE.toggleBold,
      className: 'fas fa-bold',
      title: 'Bold'
    },
    {
      name: 'italic',
      action: InscrybMDE.toggleItalic,
      className: 'fas fa-italic',
      title: 'Italic'
    },
    {
      name: 'strikethrough',
      action: InscrybMDE.toggleStrikethrough,
      className: 'fas fa-strikethrough',
      title: 'Strikethrough'
    },
    {
      name: 'heading',
      action: InscrybMDE.toggleHeadingSmaller,
      className: 'fas fa-heading',
      title: 'Heading'
    },
    '|',
    {
      name: 'quote',
      action: InscrybMDE.toggleBlockquote,
      className: 'fas fa-quote-left',
      title: 'Quote'
    },
    {
      name: 'unordered-list',
      action: InscrybMDE.toggleUnorderedList,
      className: 'fas fa-list-ul',
      title: 'Generic List'
    },
    {
      name: 'ordered-list',
      action: InscrybMDE.toggleOrderedList,
      className: 'fas fa-list-ol',
      title: 'Ordered List'
    },
    '|',
    {
      name: 'link',
      action: InscrybMDE.drawLink,
      className: 'fas fa-link',
      title: 'Create Link'
    },
    {
      name: 'image',
      action: InscrybMDE.drawImage,
      className: 'far fa-image',
      title: 'Insert Image'
    },
    '|',
    {
      name: 'preview',
      action: InscrybMDE.togglePreview,
      className: 'fas fa-eye',
      noDisable: true,
      title: 'Toggle Preview'
    },
    {
      name: 'close',
      action: closeNote,
      className: 'far fa-times-circle',
      noDisable: true,
      title: 'Close Note'
    },
    {
      name: 'remove',
      action: removeNote,
      className: 'far fa-trash-alt',
      noDisable: true,
      title: 'Delete Note'
    },
    '|',
    {
      name: 'guide',
      action: () => open('https://simplemde.com/markdown-guide'),
      className: 'fa fa-question-circle',
      noDisable: true,
      title: 'Markdown Guide'
    }
  ]
})
let fuse = new Fuse(notes, {
  shouldSort: true,
  threshold: 0.6,
  location: 0,
  distance: 100,
  maxPatternLength: 32,
  minMatchCharLength: 1,
  keys: [
    '_content'
  ]
})

class Note {
  constructor (filePath, content) {
    this.fp = filePath
    if (typeof content !== 'undefined') {
      this.content = content
    } else {
      this.setMtime()
      this.processFile()
    }
  }

  get name () {
    return this.fp.name
  }

  set name (newName) {
    this.fp.name = newName
  }

  get fullPath () {
    return path.format(this.fp)
  }

  get html () {
    return `<div id="${this.name}">
  <i class="far fa-file-alt fa-2x fa-fw"></i>
  <span class="name">${this.name}</span>
  <span class="time">${pad(this.words, 4)} words | ${moment(this.mtime, 'x').fromNow()}</span>
</div>`
  }

  set content (content) {
    let self = this
    this._content = content
    let rows = content.split('\n')
    for (let row of rows) {
      if (row.trim().length > 0) {
        let name = row.replace(nrreg, '').trim()
        if (name !== this.name) {
          fs.unlink(this.fullPath, (err) => {
            if (err) throw err
          })
          this.name = name
          this.fp.base = `${name}.txt`
        }
        break
      }
      if (row.trim().length === 0 && rows.length === 1) {
        console.log('hi')
        return removeNote()
      }
    }
    if (this.name !== '') {
      console.log(this.fullPath)
      fs.writeFile(this.fullPath, content, 'utf8', (err) => {
        if (err) throw err
        console.log(`Saved ${self.name}`)
        this.mtime = this.setMtime()
        document.querySelector('.editor-statusbar .autosave').innerHTML = moment().format('HH:mm:ss')
      })
    }
  }

  get content () {
    return this._content
  }

  get words () {
    return wordcount(this.content || '')
  }

  get tags () {
    return ((this.content || '').match(htreg) || []).map(tag => tag.substring(1).toLowerCase().trim())
  }

  setMtime () {
    let file = this.fullPath
    let self = this
    fs.stat(file, (err, stats) => {
      if (err) throw err
      self.mtime = stats.mtime.getTime()
      render(notes, currentFolder, currentSearch)
    })
  }

  processFile () {
    let file = this.fullPath
    let self = this
    fs.readFile(file, 'utf8', (err, data) => {
      if (err) throw err
      self._content = data
      render(notes, currentFolder, currentSearch)
    })
  }
}

class Folder {
  constructor (name) {
    this.name = name
    this.files = 1
  }

  addFile () {
    this.files += 1
  }

  get html () {
    return `<div id="folder:${this.name}">
  <i class="far fa-folder fa-2x fa-fw"></i>
  <span class="name">${this.name}</span>
  <span class="time">${pad(this.files, 4)} files</span>
</div>`
  }
}

function pad (str, length) {
  str = '' + str
  for (let i = str.length; i < length; i++) {
    str = '&nbsp;' + str
  }
  return str
}

function render (notes, cFolder, cSearch, count) {
  if (typeof count !== 'undefined' && counter < 5) {
    counter += 1
    return
  }
  if (typeof cSearch !== 'undefined') {
    search()
    return
  }
  counter = 0
  let html = ''
  notes = notes.sort((a, b) => {
    if (a.mtime === b.mtime) {
      if (a.name < b.name) return -1
      return 1
    }

    return b.mtime - a.mtime
  })
  folders = []
  if (typeof cFolder === 'undefined') {
    for (let note of notes) {
      for (let folder of note.tags) {
        let index = folders.findIndex(f => f.name === folder)
        if (index >= 0) {
          folders[index].addFile()
        } else {
          folders.push(new Folder(folder))
        }
      }
    }
  }

  if (typeof cFolder === 'undefined') html += folders.map(folder => folder.html).join('\n')
  let visible = notes.filter(note => (typeof cFolder === 'undefined' ? note.tags.length === 0 : note.tags.findIndex(tag => tag === cFolder.name) >= 0))
  html += visible.map(note => note.html).join('\n')
  browser.innerHTML = html

  for (let note of visible) {
    document.getElementById(note.name).addEventListener('click', loadNote)
  }
  for (let folder of folders) {
    document.getElementById(`folder:${folder.name}`).addEventListener('click', openFolder)
  }
}

function saver () {
  if (typeof currentNote === 'undefined') {
    let content = mde.value()
    let rows = content.split('\n')
    for (let row of rows) {
      if (row.length > 0) {
        let name = row.replace(nrreg, '').trim()
        currentNote = new Note(path.parse(path.join(dir, `${name}.txt`)), content)
        loadNote(undefined, currentNote.name, true)
        break
      }
    }
  } else {
    currentNote.content = mde.value()
    render(notes, currentFolder, currentSearch, true)
  }
}

function search () {
  let val = document.getElementById('searchinput').value
  if (typeof val !== 'undefined' && val !== '') {
    currentSearch = true
    let filtered = fuse.search(val)
    return render(filtered, currentFolder)
  } else {
    currentSearch = false
    return render(notes, currentFolder)
  }
}

function loadNote (event, id, noOverwrite) {
  let name = id || this.id
  if (!noOverwrite) currentNote = notes[notes.findIndex(note => note.name === name)]
  console.log(`loading: ${name}`)
  mde.codemirror.off('change')
  if (!noOverwrite) mde.value(currentNote.content)
}

function openFolder (event, id) {
  let name = id || this.id.substring(7)
  currentFolder = folders[folders.findIndex(folder => folder.name === name)]
  document.getElementById('back').classList.add('active')
  document.getElementById('folder').innerHTML = name
  render(notes, currentFolder, currentSearch)
}

function closeNote () {
  currentNote = undefined
  mde.value('')
}

function removeNote () {
  if (!confirm(`Are you sure you want to remove ${currentNote.name}`)) return
  fs.unlink(currentNote.fullPath, err => {
    if (err) throw err
  })
  currentNote = undefined
  mde.value('')
}

mde.codemirror.on('change', saver)

function setupWatcher (dir) {
  if (typeof watcher !== 'undefined') watcher.close()

  watcher = chokidar.watch(dir, {ignored: /\(\d\)\.txt$/, depth: 1})

  watcher.on('add', (file) => {
    let fp = path.parse(file)
    console.log('add', fp.name)
    if (fp.ext === '.txt') {
      notes.push(new Note(fp))
    }
  })

  watcher.on('unlink', (file) => {
    console.log('unlink', file)
    let index = notes.findIndex(note => {
      return note.fullPath === file
    })
    notes.splice(index, 1)
    render(notes, currentFolder, currentSearch)
  })
}
setupWatcher(dir)

fs.stat(dir, function (err, stats) {
  // Check if error defined and the error code is "not exists"
  if (err && err.code === 'ENOENT') {
    // Create the directory, call the callback.
    fs.mkdir(dir, (err) => {
      if (err) throw err
    })
  }
})

document.getElementById('searchinput').addEventListener('keyup', search)

document.addEventListener('click', function (event) {
  if (event.target.tagName === 'A' && event.target.href.startsWith('http')) {
    event.preventDefault()
    open(event.target.href)
  }
})

document.getElementById('theme').addEventListener('click', function (event) {
  if (window.localStorage.getItem('theme') === 'dark') {
    document.body.style.setProperty('--bg-color', '#fff')
    document.body.style.setProperty('--invert', 0)
    window.localStorage.setItem('theme', 'light')
    document.getElementById('theme').setAttribute('title', `Current theme: light\nNext theme: grey`)
  } else if (window.localStorage.getItem('theme') === 'light') {
    document.body.style.setProperty('--bg-color', '#222')
    document.body.style.setProperty('--invert', '90%')
    window.localStorage.setItem('theme', 'grey')
    document.getElementById('theme').setAttribute('title', `Current theme: grey\nNext theme: dark`)
  } else {
    document.body.style.setProperty('--bg-color', '#000')
    document.body.style.setProperty('--invert', '100%')
    window.localStorage.setItem('theme', 'dark')
    document.getElementById('theme').setAttribute('title', `Current theme: dark\nNext theme: light`)
  }
})

if (window.localStorage.getItem('theme') === 'dark') {
  document.body.style.setProperty('--bg-color', '#000')
  document.body.style.setProperty('--invert', '100%')
  document.getElementById('theme').setAttribute('title', `Current theme: dark\nNext theme: light`)
} else if (window.localStorage.getItem('theme') === 'grey') {
  document.body.style.setProperty('--bg-color', '#222')
  document.body.style.setProperty('--invert', '90%')
  document.getElementById('theme').setAttribute('title', `Current theme: grey\nNext theme: dark`)
} else {
  document.getElementById('theme').setAttribute('title', `Current theme: light\nNext theme: grey`)
}

document.getElementById('selectdir').addEventListener('click', function (event) {
  remote.dialog.showOpenDialog({
    name: 'Choose a folder where your notes should be saved',
    properties: ['openDirectory'],
    defaultPath: path.join(remote.app.getPath('userData'), 'notes')
  }, folders => {
    if (folders.length > 0) {
      dir = folders[0]
      notes = []
      window.localStorage.setItem('dir', dir)
      closeNote()
      setupWatcher(dir)
      document.getElementById('selectdir').setAttribute('title', `Current directory: ${dir}`)
    }
  })
})

document.getElementById('back').addEventListener('click', function (event) {
  currentFolder = undefined
  document.getElementById('back').classList.remove('active')
  document.getElementById('folder').innerHTML = 'Mononote'
  render(notes, currentFolder, currentSearch)
})

document.getElementById('nav-toggle').addEventListener('click', function (event) {
  document.getElementById('nav-toggle').classList.toggle('active')
  document.getElementById('browser').classList.toggle('hide')
})

document.getElementById('selectdir').setAttribute('title', `Current directory: ${dir}`)

document.querySelector('.editor-statusbar .autosave').innerHTML = '--:--:--'
