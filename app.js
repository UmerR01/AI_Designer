const chatPanel = document.getElementById('chatPanel')
const chatForm = document.getElementById('chatForm')
const chatText = document.getElementById('chatText')
const sendButton = document.getElementById('sendButton')
const galleryGrid = document.getElementById('galleryGrid')
const backendUrlInput = document.getElementById('backendUrl')
const saveBackendButton = document.getElementById('saveBackend')
const newSessionButton = document.getElementById('newSession')
const connectionStatus = document.getElementById('connectionStatus')
const pageCount = document.getElementById('pageCount')
const lastUpdate = document.getElementById('lastUpdate')

const defaultBackend = 'http://localhost:8000'
const storedBackend = localStorage.getItem('uiDesignerBackend') || defaultBackend
backendUrlInput.value = storedBackend

let ws = null
let sessionId = null
let lastImages = []
let storedDocument = null  // Store uploaded document text until user sends message
let referenceImage = null  // Base64 reference image for style guidance
let suppressDisconnectNotice = false

const createSessionId = () => {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `session-${window.crypto.randomUUID()}`
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

sessionId = createSessionId()

const resetCanvasState = () => {
  lastImages = []
  storedDocument = null
  referenceImage = null
  chatPanel.innerHTML = ''
  galleryGrid.innerHTML = ''
  renderGallery([], backendUrlInput.value.trim() || defaultBackend)
}

const addMessage = (role, text) => {
  const message = document.createElement('div')
  message.className = `chat-message ${role}`
  message.textContent = text
  chatPanel.appendChild(message)
  chatPanel.scrollTop = chatPanel.scrollHeight
}

const updateMetrics = (images) => {
  const pages = new Set((images || []).map((img) => img.page_name).filter(Boolean))
  pageCount.textContent = pages.size ? `${pages.size}` : '0'
  const latest = (images || []).map((img) => img.created_at).filter(Boolean).sort().pop()
  lastUpdate.textContent = latest ? new Date(latest).toLocaleTimeString() : '—'
}

const renderGallery = (images, backendBase) => {
  // If no images, show empty state
  if (!images || images.length === 0) {
    if (galleryGrid.innerHTML === '') {
      const empty = document.createElement('div')
      empty.className = 'chat-message system'
      empty.textContent = 'No images yet.'
      galleryGrid.appendChild(empty)
    }
    updateMetrics([])
    return
  }

  // Clear empty state if it exists
  if (galleryGrid.querySelector('.chat-message.system')) {
    galleryGrid.innerHTML = ''
  }

  // Add only new images (those not already in gallery)
  const existingIds = new Set(
    Array.from(galleryGrid.querySelectorAll('[data-image-id]')).map(el => el.getAttribute('data-image-id'))
  )

  const sorted = [...images].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  sorted.forEach((img) => {
    if (existingIds.has(img.id)) return // Skip already rendered images

    const card = document.createElement('div')
    card.className = 'gallery-card'
    card.setAttribute('data-image-id', img.id)

    const image = document.createElement('img')
    const imageUrl = `${backendBase}${img.url}`
    image.src = imageUrl
    image.alt = img.filename
    image.onerror = () => {
      console.error('Failed to load image:', imageUrl)
      card.style.backgroundColor = '#f0f0f0'
      const errorText = document.createElement('div')
      errorText.textContent = `Error loading ${img.filename}`
      errorText.style.padding = '10px'
      card.appendChild(errorText)
    }

    const meta = document.createElement('div')
    meta.className = 'meta'
    const pageLabel = img.page_name ? `${img.page_name} · ` : ''
    const timeLabel = img.created_at ? new Date(img.created_at).toLocaleTimeString() : ''
    meta.textContent = `${pageLabel}${timeLabel}`.trim() || img.filename

    card.appendChild(image)
    card.appendChild(meta)
    galleryGrid.appendChild(card)
  })

  updateMetrics(images)
}

const connectWebSocket = () => {
  const backendBase = backendUrlInput.value.trim() || defaultBackend
  const wsUrl = backendBase.replace('http', 'ws') + `/ws-ui/${sessionId}`

  if (ws) {
    ws.close()
  }

  addMessage('system', `Connecting to ${backendBase}...`)
  connectionStatus.textContent = 'Connecting'
  connectionStatus.classList.remove('online')

  ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    addMessage('system', 'Connected to UI backend')
    connectionStatus.textContent = 'Online'
    connectionStatus.classList.add('online')
  }

  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data)
    console.log('📨 WebSocket message:', payload.type, payload)

    if (payload.type === 'message' && payload.message) {
      addMessage('assistant', payload.message)
    }

    if (payload.type === 'error') {
      addMessage('system', payload.message || 'Error from server')
    }

    // Show node_start status messages (e.g., "Generating high-fidelity UI screens...")
    if (payload.type === 'node_start' && payload.message) {
      addMessage('system', payload.message)
    }

    if (payload.type === 'ui_images' && payload.data?.images) {
      // Append new images instead of replacing (for streaming)
      const newImages = payload.data.images || []
      const existingIds = new Set(lastImages.map(img => img.id))
      const uniqueNewImages = newImages.filter(img => !existingIds.has(img.id))
      
      lastImages = [...lastImages, ...uniqueNewImages]
      console.log('UI Images received:', uniqueNewImages.length, 'new images (total:', lastImages.length, ')')
      renderGallery(lastImages, backendBase)
    }

    if (payload.type === 'node_end' && payload.node_name === 'image_generator') {
      if (payload.data?.ui_images) {
        // Append images from node_end (for any stragglers)
        const newImages = payload.data.ui_images || []
        const existingIds = new Set(lastImages.map(img => img.id))
        const uniqueNewImages = newImages.filter(img => !existingIds.has(img.id))
        
        lastImages = [...lastImages, ...uniqueNewImages]
        console.log('Images from node_end:', uniqueNewImages.length, 'new images (total:', lastImages.length, ')')
        renderGallery(lastImages, backendBase)
      }
    }
  }

  ws.onclose = () => {
    if (suppressDisconnectNotice) {
      suppressDisconnectNotice = false
      return
    }
    addMessage('system', 'Disconnected. Refresh to reconnect.')
    connectionStatus.textContent = 'Offline'
    connectionStatus.classList.remove('online')
  }
}

const startNewSession = () => {
  suppressDisconnectNotice = true
  if (ws) {
    ws.close()
  }
  sessionId = createSessionId()
  resetCanvasState()
  connectWebSocket()
}

saveBackendButton.addEventListener('click', () => {
  const value = backendUrlInput.value.trim() || defaultBackend
  localStorage.setItem('uiDesignerBackend', value)
  connectWebSocket()
})

newSessionButton.addEventListener('click', () => {
  startNewSession()
})

chatForm.addEventListener('submit', (event) => {
  event.preventDefault()
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    addMessage('system', 'Not connected to backend')
    return
  }

  const text = chatText.value.trim()
  if (!text) return

  // If there's a stored document, prepend it to the user message
  let finalMessage = text
  if (storedDocument) {
    finalMessage = `[DOCUMENT CONTEXT]\n${storedDocument}\n\n[USER REQUEST]\n${text}`
    storedDocument = null  // Clear after using
  }

  addMessage('user', text)
  ws.send(JSON.stringify({
    message: finalMessage,
    session_id: sessionId,
    reference_image: referenceImage,
  }))
  chatText.value = ''
})

chatText.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.ctrlKey) {
    sendButton.click()
  }
})

// File Upload Handling
const uploadZone = document.getElementById('uploadZone')
const fileInput = document.getElementById('fileInput')
const selectFile = document.getElementById('selectFile')

selectFile.addEventListener('click', (e) => {
  e.preventDefault()
  fileInput.click()
})

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  uploadZone.classList.add('active')
})

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('active')
})

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault()
  uploadZone.classList.remove('active')
  const files = e.dataTransfer.files
  if (files.length > 0) {
    handleFileUpload(files[0])
  }
})

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFileUpload(e.target.files[0])
  }
})

const handleFileUpload = async (file) => {
  const backendBase = backendUrlInput.value.trim() || defaultBackend
  const formData = new FormData()
  formData.append('file', file)

  try {
    // Show loading skeleton
    showSkeletonLoading(3, file.name)
    addMessage('system', `📁 Uploading: ${file.name}...`)

    const response = await fetch(`${backendBase}/api/upload`, {
      method: 'POST',
      body: formData
    })

    const result = await response.json()

    if (!response.ok) {
      addMessage('system', `❌ Upload failed: ${result.error}`)
      hideSkeletonLoading()
      return
    }

    hideSkeletonLoading()

    if (result.type === 'pdf' || result.type === 'docx') {
      const preview = result.text.substring(0, 200) + '...'
      addMessage('system', `✅ ${result.type.toUpperCase()} loaded (${result.char_count} chars)\n\n📝 Preview: ${preview}\n\nNow describe what UI to generate from this document...`)
      
      // Store document for later use when user sends a message
      storedDocument = result.text
      // DON'T auto-send - wait for user message
    } else if (result.type === 'image') {
      addMessage('system', `✅ Reference image loaded (${(result.size / 1024).toFixed(1)} KB)\n\n🎨 This image will guide color & style consistency`)
      // Store reference in session
      referenceImage = result.base64
    }

    fileInput.value = ''
  } catch (error) {
    hideSkeletonLoading()
    addMessage('system', `❌ Upload error: ${error.message}`)
  }
}

const showSkeletonLoading = (count, filename) => {
  const skeletonContainer = document.createElement('div')
  skeletonContainer.className = 'skeleton-loader'
  skeletonContainer.id = 'skeletonLoader'

  for (let i = 0; i < count; i++) {
    const skeleton = document.createElement('div')
    skeleton.className = 'skeleton-card'
    skeleton.innerHTML = `
      <div class="skeleton-progress"></div>
      <div class="skeleton-info">
        <div>Generating...</div>
        <div class="skeleton-count">${i + 1} of ${count}</div>
      </div>
    `
    skeletonContainer.appendChild(skeleton)
  }

  galleryGrid.appendChild(skeletonContainer)
}

const hideSkeletonLoading = () => {
  const skeleton = document.getElementById('skeletonLoader')
  if (skeleton) {
    skeleton.remove()
  }
}

renderGallery([], storedBackend)
connectWebSocket()
