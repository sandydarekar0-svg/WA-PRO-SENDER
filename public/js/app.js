// WhatsApp Bulk Sender - Main Application JavaScript

// Configuration
const API_BASE = '/api';
let token = localStorage.getItem('token');
let user = null;
let socket = null;
let selectedMediaType = 'none';
let selectedGroupColor = '#3498db';
let bulkSendingActive = false;
let messagesChart = null;
let deliveryChart = null;

// Notification instance
const notyf = new Notyf({
    duration: 4000,
    position: { x: 'right', y: 'top' },
    types: [
        {
            type: 'success',
            background: '#10B981',
            icon: { className: 'fas fa-check', tagName: 'i' }
        },
        {
            type: 'error',
            background: '#EF4444',
            icon: { className: 'fas fa-times', tagName: 'i' }
        },
        {
            type: 'warning',
            background: '#F59E0B',
            icon: { className: 'fas fa-exclamation', tagName: 'i' }
        }
    ]
});

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    if (token) {
        try {
            const response = await apiRequest('/auth/me');
            user = response.user;
            showMainApp();
            initializeSocket();
            loadDashboard();
        } catch (error) {
            localStorage.removeItem('token');
            showAuthModal();
        }
    } else {
        showAuthModal();
    }
    
    document.getElementById('loading-screen').classList.add('hidden');
}

// Socket.IO initialization
function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Socket connected');
        socket.emit('join-room', user.id);
    });
    
    socket.on('qr-code', (data) => {
        document.getElementById('qr-loading').classList.add('hidden');
        document.getElementById('qr-code-display').classList.remove('hidden');
        document.getElementById('qr-image').src = data.qr;
    });
    
    socket.on('connection-status', (data) => {
        updateWhatsAppStatus(data.status === 'connected', data.phone);
    });
    
    socket.on('message-sent', (data) => {
        updateBulkProgress(data);
        addLogEntry(`✓ Sent to ${data.phone}`, 'success');
    });
    
    socket.on('message-failed', (data) => {
        addLogEntry(`✗ Failed: ${data.phone} - ${data.error}`, 'error');
    });
    
    socket.on('message-status', (data) => {
        console.log('Message status update:', data);
    });
    
    socket.on('batch-pause', (data) => {
        addLogEntry(`⏸ ${data.message}`, 'warning');
    });
}

// API Request helper
async function apiRequest(endpoint, method = 'GET', data = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (data) {
        options.body = JSON.stringify(data);
    }
    
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const result = await response.json();
    
    if (!response.ok) {
        throw new Error(result.error || 'Request failed');
    }
    
    return result;
}

// Authentication functions
function showAuthModal() {
    document.getElementById('auth-modal').classList.remove('hidden');
    document.getElementById('main-app').classList.add('hidden');
}

function showMainApp() {
    document.getElementById('auth-modal').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    document.getElementById('user-name').textContent = user.name;
    updateWhatsAppStatus(user.whatsappConnected, user.whatsappNumber);
}

function showLogin() {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
}

function showRegister() {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
}

async function login() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    if (!email || !password) {
        notyf.error('Please fill in all fields');
        return;
    }
    
    try {
        const response = await apiRequest('/auth/login', 'POST', { email, password });
        token = response.token;
        user = response.user;
        localStorage.setItem('token', token);
        
        notyf.success('Login successful!');
        showMainApp();
        initializeSocket();
        loadDashboard();
    } catch (error) {
        notyf.error(error.message);
    }
}

async function register() {
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    
    if (!name || !email || !password) {
        notyf.error('Please fill in all fields');
        return;
    }
    
    try {
        const response = await apiRequest('/auth/register', 'POST', { name, email, password });
        token = response.token;
        user = response.user;
        localStorage.setItem('token', token);
        
        notyf.success('Account created successfully!');
        showMainApp();
        initializeSocket();
        loadDashboard();
    } catch (error) {
        notyf.error(error.message);
    }
}

function logout() {
    localStorage.removeItem('token');
    token = null;
    user = null;
    if (socket) socket.disconnect();
    showAuthModal();
    notyf.success('Logged out successfully');
}

// Navigation
function showSection(sectionName) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    
    // Show selected section
    const section = document.getElementById(`section-${sectionName}`);
    if (section) {
        section.classList.remove('hidden');
    }
    
    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.dataset.section === sectionName) {
            link.classList.add('active');
        }
    });
    
    // Update page title
    const titles = {
        'dashboard': 'Dashboard',
        'send-message': 'Send Message',
        'bulk-sender': 'Bulk Sender',
        'contacts': 'Contacts',
        'templates': 'Templates',
        'campaigns': 'Campaigns',
        'api-keys': 'API Keys',
        'analytics': 'Analytics',
        'settings': 'Settings'
    };
    document.getElementById('page-title').textContent = titles[sectionName] || sectionName;
    
    // Load section data
    switch (sectionName) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'contacts':
            loadContacts();
            loadGroups();
            break;
        case 'templates':
            loadTemplates();
            break;
        case 'campaigns':
            loadCampaigns();
            break;
        case 'api-keys':
            loadApiKeys();
            break;
        case 'analytics':
            loadAnalytics();
            break;
        case 'settings':
            loadSettings();
            break;
        case 'send-message':
        case 'bulk-sender':
            loadTemplatesForSelect();
            loadGroupsForSelect();
            break;
    }
    
    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// Dashboard
async function loadDashboard() {
    try {
        const response = await apiRequest('/analytics/dashboard');
        const stats = response.stats;
        
        document.getElementById('stat-today-messages').textContent = stats.messages.today;
        document.getElementById('stat-total-messages').textContent = stats.messages.total;
        document.getElementById('stat-contacts').textContent = stats.contacts;
        
        // Update limits
        document.getElementById('limit-daily').textContent = `${stats.limits.usedToday} / ${stats.limits.daily}`;
        document.getElementById('limit-monthly').textContent = `${stats.limits.usedMonth} / ${stats.limits.monthly}`;
        
        const dailyPercent = (stats.limits.usedToday / stats.limits.daily) * 100;
        const monthlyPercent = (stats.limits.usedMonth / stats.limits.monthly) * 100;
        
        document.getElementById('limit-daily-bar').style.width = `${Math.min(dailyPercent, 100)}%`;
        document.getElementById('limit-monthly-bar').style.width = `${Math.min(monthlyPercent, 100)}%`;
        
    } catch (error) {
        console.error('Dashboard load error:', error);
    }
}

// WhatsApp Connection
async function connectWhatsApp() {
    try {
        document.getElementById('qr-loading').classList.remove('hidden');
        document.getElementById('qr-code-display').classList.add('hidden');
        
        await apiRequest('/whatsapp/connect', 'POST');
        notyf.success('Connecting to WhatsApp...');
    } catch (error) {
        notyf.error(error.message);
    }
}

async function disconnectWhatsApp() {
    try {
        await apiRequest('/whatsapp/disconnect', 'POST');
        updateWhatsAppStatus(false, null);
        notyf.success('WhatsApp disconnected');
    } catch (error) {
        notyf.error(error.message);
    }
}

function updateWhatsAppStatus(connected, phone) {
    const statusDot = document.getElementById('wa-status-dot');
    const statusText = document.getElementById('wa-status-text');
    const disconnectedDiv = document.getElementById('wa-disconnected');
    const connectedDiv = document.getElementById('wa-connected');
    
    if (connected) {
        statusDot.classList.remove('bg-red-500');
        statusDot.classList.add('bg-green-500', 'pulse-green');
        statusText.textContent = 'Connected';
        disconnectedDiv.classList.add('hidden');
        connectedDiv.classList.remove('hidden');
        document.getElementById('connected-number').textContent = '+' + phone;
    } else {
        statusDot.classList.remove('bg-green-500', 'pulse-green');
        statusDot.classList.add('bg-red-500');
        statusText.textContent = 'Disconnected';
        disconnectedDiv.classList.remove('hidden');
        connectedDiv.classList.add('hidden');
    }
}

// Single Message
async function checkNumber() {
    const phone = document.getElementById('single-phone').value;
    if (!phone) {
        notyf.error('Please enter a phone number');
        return;
    }
    
    try {
        const response = await apiRequest('/whatsapp/check-number', 'POST', { phone });
        if (response.exists) {
            notyf.success('Number is valid on WhatsApp');
        } else {
            notyf.error('Number not found on WhatsApp');
        }
    } catch (error) {
        notyf.error(error.message);
    }
}

function setMediaType(type) {
    selectedMediaType = type;
    document.querySelectorAll('.media-type-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        }
    });
    
    const mediaUrlContainer = document.getElementById('media-url-container');
    if (type === 'none') {
        mediaUrlContainer.classList.add('hidden');
    } else {
        mediaUrlContainer.classList.remove('hidden');
    }
}

async function sendSingleMessage() {
    const phone = document.getElementById('single-phone').value;
    const message = document.getElementById('single-message').value;
    const mediaUrl = document.getElementById('single-media-url')?.value;
    
    if (!phone || !message) {
        notyf.error('Please enter phone number and message');
        return;
    }
    
    try {
        await apiRequest('/whatsapp/send', 'POST', {
            phone,
            message,
            mediaType: selectedMediaType !== 'none' ? selectedMediaType : null,
            mediaUrl: selectedMediaType !== 'none' ? mediaUrl : null
        });
        
        notyf.success('Message sent successfully!');
        document.getElementById('single-phone').value = '';
        document.getElementById('single-message').value = '';
    } catch (error) {
        notyf.error(error.message);
    }
}

// Bulk Sender
function selectRecipientType(type) {
    document.querySelectorAll('.recipient-type-btn').forEach(btn => {
        btn.classList.remove('active', 'border-green-500');
        btn.classList.add('border-transparent');
    });
    
    document.querySelector(`[data-type="${type}"]`).classList.add('active', 'border-green-500');
    document.querySelector(`[data-type="${type}"]`).classList.remove('border-transparent');
    
    if (type === 'groups') {
        document.getElementById('groups-selection').classList.remove('hidden');
        document.getElementById('manual-entry').classList.add('hidden');
    } else {
        document.getElementById('groups-selection').classList.add('hidden');
        document.getElementById('manual-entry').classList.remove('hidden');
    }
}

function toggleBulkMedia() {
    const mediaType = document.getElementById('bulk-media-type').value;
    const container = document.getElementById('bulk-media-url-container');
    
    if (mediaType === 'none') {
        container.classList.add('hidden');
    } else {
        container.classList.remove('hidden');
    }
}

async function startBulkSend() {
    const message = document.getElementById('bulk-message').value;
    if (!message) {
        notyf.error('Please enter a message');
        return;
    }
    
    // Get recipients
    let messages = [];
    const recipientType = document.querySelector('.recipient-type-btn.active').dataset.type;
    
    if (recipientType === 'groups') {
        const selectedGroups = Array.from(document.getElementById('bulk-groups').selectedOptions).map(o => o.value);
        if (selectedGroups.length === 0) {
            notyf.error('Please select at least one group');
            return;
        }
        
        // Load contacts from groups
        try {
            for (const groupId of selectedGroups) {
                const response = await apiRequest(`/contacts?groupId=${groupId}`);
                response.contacts.forEach(contact => {
                    messages.push({
                        phone: contact.phone,
                        message,
                        variables: {
                            name: contact.name || '',
                            phone: contact.phone,
                            ...contact.variables
                        }
                    });
                });
            }
        } catch (error) {
            notyf.error('Failed to load contacts');
            return;
        }
    } else {
        const numbers = document.getElementById('bulk-numbers').value.split('\n').filter(n => n.trim());
        if (numbers.length === 0) {
            notyf.error('Please enter phone numbers');
            return;
        }
        
        messages = numbers.map(phone => ({
            phone: phone.trim(),
            message,
            variables: { phone: phone.trim() }
        }));
    }
    
    // Get settings
    const settings = {
        minDelay: parseInt(document.getElementById('min-delay').value) * 1000,
        maxDelay: parseInt(document.getElementById('max-delay').value) * 1000,
        useSpintax: document.getElementById('use-spintax').checked
    };
    
    // Add media if selected
    const mediaType = document.getElementById('bulk-media-type').value;
    if (mediaType !== 'none') {
        const mediaUrl = document.getElementById('bulk-media-url').value;
        messages = messages.map(m => ({
            ...m,
            mediaType,
            mediaUrl
        }));
    }
    
    // Update UI
    document.getElementById('bulk-total').textContent = messages.length;
    document.getElementById('bulk-sent').textContent = '0';
    document.getElementById('bulk-failed').textContent = '0';
    document.getElementById('bulk-remaining').textContent = messages.length;
    
    document.getElementById('start-bulk-btn').classList.add('hidden');
    document.getElementById('pause-bulk-btn').classList.remove('hidden');
    document.getElementById('stop-bulk-btn').classList.remove('hidden');
    
    clearLog();
    addLogEntry('Starting bulk send...', 'info');
    
    bulkSendingActive = true;
    
    // Send request
    try {
        await apiRequest('/whatsapp/send-bulk', 'POST', { messages, settings });
    } catch (error) {
        notyf.error(error.message);
        resetBulkUI();
    }
}

function updateBulkProgress(data) {
    const total = parseInt(document.getElementById('bulk-total').textContent);
    const sent = parseInt(document.getElementById('bulk-sent').textContent) + 1;
    const progress = (sent / total) * 100;
    
    document.getElementById('bulk-sent').textContent = sent;
    document.getElementById('bulk-remaining').textContent = total - sent;
    document.getElementById('progress-percent').textContent = `${Math.round(progress)}%`;
    
    // Update progress circle
    const circle = document.getElementById('progress-circle');
    const circumference = 352; // 2 * π * 56
    const offset = circumference - (progress / 100) * circumference;
    circle.style.strokeDashoffset = offset;
    
    if (sent >= total) {
        addLogEntry('Bulk send completed!', 'success');
        resetBulkUI();
    }
}

function addLogEntry(message, type) {
    const log = document.getElementById('bulk-log');
    const entry = document.createElement('p');
    entry.className = `log-${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

function clearLog() {
    document.getElementById('bulk-log').innerHTML = '';
}

function resetBulkUI() {
    bulkSendingActive = false;
    document.getElementById('start-bulk-btn').classList.remove('hidden');
    document.getElementById('pause-bulk-btn').classList.add('hidden');
    document.getElementById('stop-bulk-btn').classList.add('hidden');
}

function pauseBulkSend() {
    // Implementation for pause
    notyf.warning('Pausing...');
}

function stopBulkSend() {
    bulkSendingActive = false;
    resetBulkUI();
    addLogEntry('Bulk send stopped by user', 'warning');
    notyf.warning('Bulk send stopped');
}

// Contacts
async function loadContacts(page = 1) {
    try {
        const search = document.getElementById('contact-search')?.value || '';
        const groupId = document.getElementById('contact-group-filter')?.value || '';
        
        const response = await apiRequest(`/contacts?page=${page}&search=${search}&groupId=${groupId}`);
        
        const tbody = document.getElementById('contacts-table-body');
        
        if (response.contacts.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="px-4 py-8 text-center text-gray-400">
                        No contacts found
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = response.contacts.map(contact => `
            <tr class="border-b border-gray-700">
                <td class="px-4 py-3">
                    <input type="checkbox" class="contact-checkbox" value="${contact.id}">
                </td>
                <td class="px-4 py-3">${contact.phone}</td>
                <td class="px-4 py-3">${contact.name || '-'}</td>
                <td class="px-4 py-3">
                    ${contact.ContactGroup ? 
                        `<span class="px-2 py-1 rounded-full text-xs" style="background: ${contact.ContactGroup.color}20; color: ${contact.ContactGroup.color}">${contact.ContactGroup.name}</span>` 
                        : '-'}
                </td>
                <td class="px-4 py-3">
                    <span class="px-2 py-1 rounded-full text-xs ${contact.isValid ? 'badge-sent' : 'badge-failed'}">
                        ${contact.isValid ? 'Valid' : 'Invalid'}
                    </span>
                </td>
                <td class="px-4 py-3">${contact.lastContacted ? new Date(contact.lastContacted).toLocaleDateString() : '-'}</td>
                <td class="px-4 py-3">
                    <button onclick="editContact('${contact.id}')" class="text-blue-500 hover:text-blue-400 mr-2">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteContact('${contact.id}')" class="text-red-500 hover:text-red-400">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
        
        document.getElementById('contacts-count').textContent = `${response.pagination.total} contacts`;
        
    } catch (error) {
        notyf.error('Failed to load contacts');
    }
}

async function loadGroups() {
    try {
        const response = await apiRequest('/contacts/groups');
        
        const container = document.getElementById('groups-container');
        container.innerHTML = response.groups.map(group => `
            <div class="bg-gray-800 rounded-xl border border-gray-700 p-6 hover-card">
                <div class="flex items-center justify-between mb-4">
                    <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background: ${group.color}">
                        <i class="fas fa-users text-white"></i>
                    </div>
                    <div class="flex space-x-2">
                        <button onclick="editGroup('${group.id}')" class="text-gray-400 hover:text-white">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="deleteGroup('${group.id}')" class="text-gray-400 hover:text-red-500">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <h4 class="font-semibold">${group.name}</h4>
                <p class="text-sm text-gray-400 mt-1">${group.contactCount} contacts</p>
            </div>
        `).join('');
        
        // Update group filter
        const filterSelect = document.getElementById('contact-group-filter');
        filterSelect.innerHTML = '<option value="">All Groups</option>' + 
            response.groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
            
    } catch (error) {
        console.error('Failed to load groups:', error);
    }
}

async function loadGroupsForSelect() {
    try {
        const response = await apiRequest('/contacts/groups');
        
        const selects = ['bulk-groups', 'new-contact-group', 'import-group'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                if (id === 'bulk-groups') {
                    select.innerHTML = response.groups.map(g => 
                        `<option value="${g.id}">${g.name} (${g.contactCount})</option>`
                    ).join('');
                } else {
                    select.innerHTML = '<option value="">No Group</option>' + 
                        response.groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
                }
            }
        });
    } catch (error) {
        console.error('Failed to load groups for select:', error);
    }
}

function showContactsTab(tab) {
    document.querySelectorAll('.contacts-tab').forEach(t => {
        t.classList.remove('active');
        t.classList.add('bg-gray-700');
        t.classList.remove('bg-green-600');
    });
    
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active', 'bg-green-600');
    document.querySelector(`[data-tab="${tab}"]`).classList.remove('bg-gray-700');
    
    if (tab === 'all') {
        document.getElementById('contacts-all-tab').classList.remove('hidden');
        document.getElementById('contacts-groups-tab').classList.add('hidden');
    } else {
        document.getElementById('contacts-all-tab').classList.add('hidden');
        document.getElementById('contacts-groups-tab').classList.remove('hidden');
    }
}

function showAddContactModal() {
    loadGroupsForSelect();
    document.getElementById('add-contact-modal').classList.remove('hidden');
}

function showImportModal() {
    loadGroupsForSelect();
    document.getElementById('import-modal').classList.remove('hidden');
}

function showCreateGroupModal() {
    document.getElementById('create-group-modal').classList.remove('hidden');
}

async function addContact() {
    const phone = document.getElementById('new-contact-phone').value;
    const name = document.getElementById('new-contact-name').value;
    const email = document.getElementById('new-contact-email').value;
    const groupId = document.getElementById('new-contact-group').value;
    
    if (!phone) {
        notyf.error('Please enter a phone number');
        return;
    }
    
    try {
        await apiRequest('/contacts', 'POST', { phone, name, email, groupId: groupId || null });
        notyf.success('Contact added successfully');
        closeModal('add-contact-modal');
        loadContacts();
    } catch (error) {
        notyf.error(error.message);
    }
}

async function deleteContact(id) {
    if (!confirm('Are you sure you want to delete this contact?')) return;
    
    try {
        await apiRequest(`/contacts/${id}`, 'DELETE');
        notyf.success('Contact deleted');
        loadContacts();
    } catch (error) {
        notyf.error(error.message);
    }
}

function selectGroupColor(color) {
    selectedGroupColor = color;
    document.querySelectorAll('.group-color-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    document.getElementById('group-color').value = color;
}

async function createGroup() {
    const name = document.getElementById('group-name').value;
    const description = document.getElementById('group-description').value;
    const color = document.getElementById('group-color').value;
    
    if (!name) {
        notyf.error('Please enter a group name');
        return;
    }
    
    try {
        await apiRequest('/contacts/groups', 'POST', { name, description, color });
        notyf.success('Group created successfully');
        closeModal('create-group-modal');
        loadGroups();
    } catch (error) {
        notyf.error(error.message);
    }
}

async function deleteGroup(id) {
    if (!confirm('Are you sure? Contacts will be moved to no group.')) return;
    
    try {
        await apiRequest(`/contacts/groups/${id}`, 'DELETE');
        notyf.success('Group deleted');
        loadGroups();
    } catch (error) {
        notyf.error(error.message);
    }
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        document.getElementById('import-file-name').classList.remove('hidden');
        document.getElementById('import-file-name').textContent = `Selected: ${file.name}`;
    }
}

async function importContacts() {
    const fileInput = document.getElementById('import-file');
    const groupId = document.getElementById('import-group').value;
    
    if (!fileInput.files[0]) {
        notyf.error('Please select a file');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('groupId', groupId);
    
    try {
        const response = await fetch(`${API_BASE}/contacts/import`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            notyf.success(`Imported: ${result.results.success}, Duplicates: ${result.results.duplicates}, Failed: ${result.results.failed}`);
            closeModal('import-modal');
            loadContacts();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        notyf.error(error.message);
    }
}

async function exportContacts() {
    window.open(`${API_BASE}/contacts/export?token=${token}`, '_blank');
}

function searchContacts() {
    loadContacts();
}

function filterContacts() {
    loadContacts();
}

// Templates
async function loadTemplates() {
    try {
        const response = await apiRequest('/templates');
        
        const grid = document.getElementById('templates-grid');
        
        if (response.templates.length === 0) {
            grid.innerHTML = `
                <div onclick="showCreateTemplateModal()" class="bg-gray-800 rounded-xl border-2 border-dashed border-gray-600 p-6 flex flex-col items-center justify-center cursor-pointer hover:border-green-500 transition-colors min-h-48">
                    <i class="fas fa-plus text-3xl text-gray-400 mb-2"></i>
                    <span class="text-gray-400">Create First Template</span>
                </div>
            `;
            return;
        }
        
        grid.innerHTML = response.templates.map(template => `
            <div class="bg-gray-800 rounded-xl border border-gray-700 p-6 template-card">
                <div class="flex items-center justify-between mb-4">
                    <span class="px-2 py-1 rounded-full text-xs bg-gray-700">${template.category}</span>
                    <div class="flex space-x-2">
                        <button onclick="editTemplate('${template.id}')" class="text-gray-400 hover:text-white">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="duplicateTemplate('${template.id}')" class="text-gray-400 hover:text-blue-500">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button onclick="deleteTemplate('${template.id}')" class="text-gray-400 hover:text-red-500">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <h4 class="font-semibold mb-2">${template.name}</h4>
                <p class="text-sm text-gray-400 line-clamp-3">${template.content.substring(0, 100)}...</p>
                <div class="mt-4 flex items-center justify-between text-xs text-gray-500">
                    <span>${template.mediaType !== 'none' ? `<i class="fas fa-${template.mediaType === 'image' ? 'image' : template.mediaType === 'video' ? 'video' : 'file'}"></i> ${template.mediaType}` : 'No media'}</span>
                    <span>Used ${template.usageCount} times</span>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        notyf.error('Failed to load templates');
    }
}

async function loadTemplatesForSelect() {
    try {
        const response = await apiRequest('/templates');
        
        const selects = ['single-template', 'bulk-template'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                select.innerHTML = '<option value="">Select a template...</option>' + 
                    response.templates.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
            }
        });
    } catch (error) {
        console.error('Failed to load templates for select:', error);
    }
}

async function loadTemplate() {
    const templateId = document.getElementById('single-template').value;
    if (!templateId) return;
    
    try {
        const response = await apiRequest(`/templates/${templateId}`);
        document.getElementById('single-message').value = response.template.content;
        
        if (response.template.mediaType !== 'none') {
            setMediaType(response.template.mediaType);
            document.getElementById('single-media-url').value = response.template.mediaUrl || '';
        }
    } catch (error) {
        notyf.error('Failed to load template');
    }
}

async function loadBulkTemplate() {
    const templateId = document.getElementById('bulk-template').value;
    if (!templateId) return;
    
    try {
        const response = await apiRequest(`/templates/${templateId}`);
        document.getElementById('bulk-message').value = response.template.content;
        
        document.getElementById('bulk-media-type').value = response.template.mediaType;
        toggleBulkMedia();
        
        if (response.template.mediaType !== 'none') {
            document.getElementById('bulk-media-url').value = response.template.mediaUrl || '';
        }
        
        document.getElementById('use-spintax').checked = response.template.useSpintax;
    } catch (error) {
        notyf.error('Failed to load template');
    }
}

function showCreateTemplateModal() {
    document.getElementById('create-template-modal').classList.remove('hidden');
}

function toggleTemplateMedia() {
    const mediaType = document.getElementById('template-media-type').value;
    const container = document.getElementById('template-media-url-container');
    
    if (mediaType === 'none') {
        container.classList.add('hidden');
    } else {
        container.classList.remove('hidden');
    }
}

async function createTemplate() {
    const name = document.getElementById('template-name').value;
    const category = document.getElementById('template-category').value;
    const content = document.getElementById('template-content').value;
    const mediaType = document.getElementById('template-media-type').value;
    const mediaUrl = document.getElementById('template-media-url').value;
    const footer = document.getElementById('template-footer').value;
    const useSpintax = document.getElementById('template-spintax').checked;
    
    if (!name || !content) {
        notyf.error('Please fill in required fields');
        return;
    }
    
    try {
        await apiRequest('/templates', 'POST', {
            name,
            category,
            content,
            mediaType,
            mediaUrl: mediaType !== 'none' ? mediaUrl : null,
            footer,
            useSpintax
        });
        
        notyf.success('Template created successfully');
        closeModal('create-template-modal');
        loadTemplates();
        
        // Reset form
        document.getElementById('template-name').value = '';
        document.getElementById('template-content').value = '';
        document.getElementById('template-footer').value = '';
    } catch (error) {
        notyf.error(error.message);
    }
}

async function deleteTemplate(id) {
    if (!confirm('Are you sure you want to delete this template?')) return;
    
    try {
        await apiRequest(`/templates/${id}`, 'DELETE');
        notyf.success('Template deleted');
        loadTemplates();
    } catch (error) {
        notyf.error(error.message);
    }
}

async function duplicateTemplate(id) {
    try {
        await apiRequest(`/templates/${id}/duplicate`, 'POST');
        notyf.success('Template duplicated');
        loadTemplates();
    } catch (error) {
        notyf.error(error.message);
    }
}

// API Keys
async function loadApiKeys() {
    try {
        const response = await apiRequest('/external/keys');
        
        const container = document.getElementById('api-keys-list');
        
        if (response.keys.length === 0) {
            container.innerHTML = '<p class="text-gray-400 text-center py-8">No API keys generated yet</p>';
            return;
        }
        
        container.innerHTML = response.keys.map(key => `
            <div class="flex items-center justify-between p-4 bg-gray-700 rounded-lg mb-4">
                <div>
                    <h4 class="font-semibold">${key.name}</h4>
                    <code class="text-sm text-gray-400">${key.key.substring(0, 20)}...</code>
                    <div class="text-xs text-gray-500 mt-1">
                        Created: ${new Date(key.createdAt).toLocaleDateString()} | 
                        Requests: ${key.requestCount} |
                        ${key.isActive ? '<span class="text-green-500">Active</span>' : '<span class="text-red-500">Inactive</span>'}
                    </div>
                </div>
                <div class="flex space-x-2">
                    <button onclick="toggleApiKey('${key.id}', ${!key.isActive})" class="px-3 py-2 ${key.isActive ? 'bg-yellow-600' : 'bg-green-600'} rounded-lg text-sm">
                        ${key.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button onclick="deleteApiKey('${key.id}')" class="px-3 py-2 bg-red-600 rounded-lg text-sm">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        notyf.error('Failed to load API keys');
    }
}

function showCreateApiKeyModal() {
    document.getElementById('create-api-key-modal').classList.remove('hidden');
}

async function generateApiKey() {
    const name = document.getElementById('api-key-name').value;
    const rateLimit = document.getElementById('api-rate-limit').value;
    const webhookUrl = document.getElementById('api-webhook-url').value;
    
    const permissions = Array.from(document.querySelectorAll('.api-permission:checked'))
        .map(cb => cb.value);
    
    if (!name) {
        notyf.error('Please enter a key name');
        return;
    }
    
    try {
        const response = await apiRequest('/external/keys', 'POST', {
            name,
            permissions,
            rateLimit: parseInt(rateLimit),
            webhookUrl: webhookUrl || null
        });
        
        // Show result modal
        document.getElementById('generated-api-key').value = response.apiKey.key;
        document.getElementById('generated-api-secret').value = response.apiKey.secret;
        
        closeModal('create-api-key-modal');
        document.getElementById('api-key-result-modal').classList.remove('hidden');
        
        loadApiKeys();
        
        // Reset form
        document.getElementById('api-key-name').value = '';
    } catch (error) {
        notyf.error(error.message);
    }
}

async function toggleApiKey(id, isActive) {
    try {
        await apiRequest(`/external/keys/${id}`, 'PUT', { isActive });
        notyf.success(`API key ${isActive ? 'enabled' : 'disabled'}`);
        loadApiKeys();
    } catch (error) {
        notyf.error(error.message);
    }
}

async function deleteApiKey(id) {
    if (!confirm('Are you sure you want to revoke this API key?')) return;
    
    try {
        await apiRequest(`/external/keys/${id}`, 'DELETE');
        notyf.success('API key revoked');
        loadApiKeys();
    } catch (error) {
        notyf.error(error.message);
    }
}

function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    element.select();
    document.execCommand('copy');
    notyf.success('Copied to clipboard');
}

// Analytics
async function loadAnalytics() {
    try {
        const response = await apiRequest('/analytics/dashboard');
        
        // Create messages chart
        const messagesCtx = document.getElementById('messages-chart').getContext('2d');
        if (messagesChart) messagesChart.destroy();
        
        messagesChart = new Chart(messagesCtx, {
            type: 'line',
            data: {
                labels: response.stats.dailyStats.map(d => d.date),
                datasets: [{
                    label: 'Messages',
                    data: response.stats.dailyStats.map(d => d.count),
                    borderColor: '#10B981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: '#374151' }
                    },
                    x: {
                        grid: { color: '#374151' }
                    }
                }
            }
        });
        
        // Create delivery chart
        const deliveryCtx = document.getElementById('delivery-chart').getContext('2d');
        if (deliveryChart) deliveryChart.destroy();
        
        const breakdown = response.stats.messages.breakdown;
        deliveryChart = new Chart(deliveryCtx, {
            type: 'doughnut',
            data: {
                labels: breakdown.map(b => b.status),
                datasets: [{
                    data: breakdown.map(b => b.count),
                    backgroundColor: [
                        '#10B981', // sent
                        '#3B82F6', // delivered
                        '#8B5CF6', // read
                        '#EF4444', // failed
                        '#F59E0B'  // pending
                    ]
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
        
        // Load message history
        loadMessageHistory();
        
    } catch (error) {
        console.error('Failed to load analytics:', error);
    }
}

async function loadMessageHistory(page = 1) {
    try {
        const status = document.getElementById('history-status-filter')?.value || '';
        const response = await apiRequest(`/analytics/messages?page=${page}&status=${status}`);
        
        const tbody = document.getElementById('history-table-body');
        
        if (response.messages.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-4 py-8 text-center text-gray-400">
                        No messages found
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = response.messages.map(msg => `
            <tr class="border-b border-gray-700">
                <td class="px-4 py-3">${msg.phone}</td>
                <td class="px-4 py-3 max-w-xs truncate">${msg.message}</td>
                <td class="px-4 py-3">
                    <span class="px-2 py-1 rounded-full text-xs badge-${msg.status}">
                        ${msg.status}
                    </span>
                </td>
                <td class="px-4 py-3">${msg.source}</td>
                <td class="px-4 py-3">${msg.sentAt ? new Date(msg.sentAt).toLocaleString() : '-'}</td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Failed to load message history:', error);
    }
}

// Settings
async function loadSettings() {
    document.getElementById('settings-name').value = user.name;
    document.getElementById('settings-email').value = user.email;
    document.getElementById('settings-plan').textContent = user.plan.charAt(0).toUpperCase() + user.plan.slice(1);
    
    if (user.settings) {
        document.getElementById('default-min-delay').value = (user.settings.minDelay || 3000) / 1000;
        document.getElementById('default-max-delay').value = (user.settings.maxDelay || 8000) / 1000;
        document.getElementById('batch-size').value = user.settings.batchSize || 50;
        document.getElementById('timezone').value = user.settings.timezone || 'UTC';
    }
    
    // Check WhatsApp status
    try {
        const response = await apiRequest('/whatsapp/status');
        updateWhatsAppStatus(response.status.connected, response.status.phone);
    } catch (error) {
        console.error('Failed to get WhatsApp status:', error);
    }
}

async function updateProfile() {
    const name = document.getElementById('settings-name').value;
    
    try {
        await apiRequest('/auth/profile', 'PUT', { name });
        user.name = name;
        document.getElementById('user-name').textContent = name;
        notyf.success('Profile updated');
    } catch (error) {
        notyf.error(error.message);
    }
}

async function saveMessageSettings() {
    const settings = {
        minDelay: parseInt(document.getElementById('default-min-delay').value) * 1000,
        maxDelay: parseInt(document.getElementById('default-max-delay').value) * 1000,
        batchSize: parseInt(document.getElementById('batch-size').value),
        timezone: document.getElementById('timezone').value
    };
    
    try {
        await apiRequest('/auth/profile', 'PUT', { settings });
        user.settings = settings;
        notyf.success('Settings saved');
    } catch (error) {
        notyf.error(error.message);
    }
}

async function changePassword() {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    
    if (!currentPassword || !newPassword || !confirmPassword) {
        notyf.error('Please fill in all fields');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        notyf.error('Passwords do not match');
        return;
    }
    
    try {
        await apiRequest('/auth/password', 'PUT', { currentPassword, newPassword });
        notyf.success('Password changed successfully');
        
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
    } catch (error) {
        notyf.error(error.message);
    }
}

// Campaigns
async function loadCampaigns() {
    try {
        const response = await apiRequest('/campaigns');
        
        const container = document.getElementById('campaigns-list');
        
        if (response.campaigns.length === 0) {
            container.innerHTML = '<p class="text-gray-400 text-center py-8">No campaigns found</p>';
            return;
        }
        
        container.innerHTML = response.campaigns.map(campaign => `
            <div class="flex items-center justify-between p-4 bg-gray-700 rounded-lg mb-4">
                <div>
                    <h4 class="font-semibold">${campaign.name}</h4>
                    <div class="text-sm text-gray-400 mt-1">
                        <span class="px-2 py-1 rounded-full text-xs badge-${campaign.status === 'completed' ? 'sent' : campaign.status === 'running' ? 'delivered' : campaign.status === 'failed' ? 'failed' : 'pending'}">
                            ${campaign.status}
                        </span>
                        <span class="ml-2">
                            ${campaign.sentCount}/${campaign.totalContacts} sent
                        </span>
                    </div>
                </div>
                <div class="flex space-x-2">
                    ${campaign.status === 'draft' ? `
                        <button onclick="startCampaign('${campaign.id}')" class="px-3 py-2 bg-green-600 rounded-lg text-sm">
                            <i class="fas fa-play"></i> Start
                        </button>
                    ` : ''}
                    ${campaign.status === 'running' ? `
                        <button onclick="pauseCampaign('${campaign.id}')" class="px-3 py-2 bg-yellow-600 rounded-lg text-sm">
                            <i class="fas fa-pause"></i>
                        </button>
                    ` : ''}
                    ${campaign.status === 'paused' ? `
                        <button onclick="resumeCampaign('${campaign.id}')" class="px-3 py-2 bg-green-600 rounded-lg text-sm">
                            <i class="fas fa-play"></i>
                        </button>
                    ` : ''}
                    <button onclick="viewCampaign('${campaign.id}')" class="px-3 py-2 bg-gray-600 rounded-lg text-sm">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button onclick="deleteCampaign('${campaign.id}')" class="px-3 py-2 bg-red-600 rounded-lg text-sm">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        notyf.error('Failed to load campaigns');
    }
}

async function startCampaign(id) {
    try {
        await apiRequest(`/campaigns/${id}/start`, 'POST');
        notyf.success('Campaign started');
        loadCampaigns();
    } catch (error) {
        notyf.error(error.message);
    }
}

async function pauseCampaign(id) {
    try {
        await apiRequest(`/campaigns/${id}/pause`, 'POST');
        notyf.success('Campaign paused');
        loadCampaigns();
    } catch (error) {
        notyf.error(error.message);
    }
}

async function resumeCampaign(id) {
    try {
        await apiRequest(`/campaigns/${id}/resume`, 'POST');
        notyf.success('Campaign resumed');
        loadCampaigns();
    } catch (error) {
        notyf.error(error.message);
    }
}

async function deleteCampaign(id) {
    if (!confirm('Are you sure you want to delete this campaign?')) return;
    
    try {
        await apiRequest(`/campaigns/${id}`, 'DELETE');
        notyf.success('Campaign deleted');
        loadCampaigns();
    } catch (error) {
        notyf.error(error.message);
    }
}

// Utility functions
function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

// Close modals on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('[id$="-modal"]').forEach(modal => {
            modal.classList.add('hidden');
        });
    }
});

// Character count for message input
document.getElementById('single-message')?.addEventListener('input', function() {
    document.getElementById('char-count').textContent = this.value.length + ' characters';
});

// Initialize first load
showSection('dashboard');
