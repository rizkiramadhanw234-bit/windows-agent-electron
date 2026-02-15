console.log('🚀 Setup Wizard JS loaded');

// Global state
let currentStep = 1;
const elements = {};
let backendURL = null;
let companyData = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('✅ DOM loaded');
    initialize();
});

function initialize() {
    // Get all elements
    getElements();

    // Setup event listeners
    setupEventListeners();

    // Initialize system info
    initializeSystemInfo();

    // Generate agent ID
    generateAgentId();

    // Force enable buttons
    forceEnableButtons();

    console.log('✅ Setup Wizard initialized');
}

function getElements() {
    // Step 1
    elements.backendUrlInput = document.getElementById('backendUrl');
    elements.testConnectionBtn = document.getElementById('testConnectionBtn');
    elements.nextStep1Btn = document.getElementById('nextStep1');
    elements.connectionStatus = document.getElementById('connectionStatus');

    // Step 2
    elements.companyInput = document.getElementById('company');
    elements.companyNameInput = document.getElementById('companyName');
    elements.locationInput = document.getElementById('location');
    elements.emailInput = document.getElementById('email');
    elements.phoneInput = document.getElementById('phone');
    elements.websiteInput = document.getElementById('website');
    elements.departmentInput = document.getElementById('department');
    elements.nextStep2Btn = document.getElementById('nextStep2');
    elements.prevStep2Btn = document.getElementById('prevStep2');

    // Step 3
    elements.systemHostnameSpan = document.getElementById('systemHostname');
    elements.systemPlatformSpan = document.getElementById('systemPlatform');
    elements.systemMacSpan = document.getElementById('systemMac');
    elements.registerBtn = document.getElementById('registerBtn');
    elements.registrationProgress = document.getElementById('registrationProgress');
    elements.progressText = document.getElementById('progressText');
    elements.registrationMessages = document.getElementById('registrationMessages');
    elements.prevStep3Btn = document.getElementById('prevStep3');

    // Review elements
    elements.reviewBackendUrl = document.getElementById('reviewBackendUrl');
    elements.reviewCompanyName = document.getElementById('reviewCompanyName');
    elements.reviewCompanyId = document.getElementById('reviewCompanyId');
    elements.reviewLicenseKey = document.getElementById('reviewLicenseKey');
    elements.reviewLocation = document.getElementById('reviewLocation');
    elements.reviewEmail = document.getElementById('reviewEmail');
    elements.reviewPhone = document.getElementById('reviewPhone');
    elements.reviewWebsite = document.getElementById('reviewWebsite');
    elements.reviewDepartment = document.getElementById('reviewDepartment');

    // Success screen
    elements.successScreen = document.getElementById('success-screen');
    elements.successAgentId = document.getElementById('successAgentId');
    elements.successBackendUrl = document.getElementById('successBackendUrl');
    elements.successCompany = document.getElementById('successCompany');
    elements.finishBtn = document.getElementById('finishBtn');
}

function setupEventListeners() {
    // Navigation
    if (elements.nextStep1Btn) elements.nextStep1Btn.addEventListener('click', () => goToStep(2));
    if (elements.nextStep2Btn) elements.nextStep2Btn.addEventListener('click', () => goToStep(3));
    if (elements.prevStep2Btn) elements.prevStep2Btn.addEventListener('click', () => goToStep(1));
    if (elements.prevStep3Btn) elements.prevStep3Btn.addEventListener('click', () => goToStep(2));

    // Test Connection
    if (elements.testConnectionBtn) {
        elements.testConnectionBtn.addEventListener('click', testConnection);
    }

    // URL validation
    if (elements.backendUrlInput) {
        elements.backendUrlInput.addEventListener('input', validateStep1);
        setTimeout(validateStep1, 100);
    }

    // Company license input
    if (elements.companyInput) {
        let currentLicenseKey = '';

        elements.companyInput.addEventListener('input', debounce(async (event) => {
            const licenseKey = event.target.value.trim();

            if (licenseKey === currentLicenseKey) return;

            currentLicenseKey = licenseKey;

            if (licenseKey.length < 5) {
                updateLicenseStatus('Enter license key (min. 5 chars)...', 'info');
                resetCompanyData();
                return;
            }

            console.log('Verifying license key:', licenseKey);

            try {
                updateLicenseStatus('Checking license...', 'loading');

                const result = await verifyLicense(licenseKey);
                console.log('License verification successful:', result);

                if (result.success && elements.departmentInput && !elements.departmentInput.disabled) {
                    setTimeout(() => {
                        elements.departmentInput.focus();
                    }, 300);
                }

            } catch (error) {
                console.log('License verification failed:', error.message);
            }
        }, 1000));
    }

    // Department dropdown change
    if (elements.departmentInput) {
        elements.departmentInput.addEventListener('change', function () {
            console.log('Department changed:', this.value);
            validateStep2();
        });
    }

    // Register
    if (elements.registerBtn) {
        elements.registerBtn.addEventListener('click', registerAgent);
    }

    // Finish
    if (elements.finishBtn) {
        elements.finishBtn.addEventListener('click', finishSetup);
    }
}

function initializeSystemInfo() {
    if (window.electronAPI && window.electronAPI.getSystemInfo) {
        window.electronAPI.getSystemInfo()
            .then(info => {
                if (elements.systemHostnameSpan) elements.systemHostnameSpan.textContent = info.hostname;
                if (elements.systemPlatformSpan) elements.systemPlatformSpan.textContent = info.platform;
                if (elements.systemMacSpan) elements.systemMacSpan.textContent = info.macAddress;
            })
            .catch(error => {
                console.error('System info error:', error);
            });
    }
}

function generateAgentId() {
    const hostname = elements.systemHostnameSpan?.textContent || 'unknown';
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 4);
    const autoId = `${hostname}_${timestamp}_${random}`.substr(0, 50);

    const agentIdInput = document.getElementById('agentId');
    if (!agentIdInput) {
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.id = 'agentId';
        hiddenInput.value = autoId;
        document.body.appendChild(hiddenInput);
    }
}

function forceEnableButtons() {
    if (elements.testConnectionBtn) {
        elements.testConnectionBtn.disabled = false;
    }

    if (elements.nextStep1Btn && elements.backendUrlInput && elements.backendUrlInput.value) {
        elements.nextStep1Btn.disabled = false;
    }
}

function goToStep(step) {
    console.log('Going to step:', step, 'from step:', currentStep);

    if (step === 2) {
        const url = elements.backendUrlInput?.value.trim();
        backendURL = url;
        console.log('Backend URL set to:', backendURL);
        resetCompanyData();
    }

    if (step === 3) {
        updateReview();
    }

    document.querySelectorAll('.step').forEach(stepEl => {
        const stepNum = parseInt(stepEl.dataset.step);
        stepEl.classList.toggle('active', stepNum === step);
        stepEl.classList.toggle('completed', stepNum < step);
    });

    document.querySelectorAll('.step-content').forEach(content => {
        const contentStep = parseInt(content.id.split('-')[1]);
        content.classList.toggle('active', contentStep === step);
    });

    currentStep = step;
}

function validateStep1() {
    if (!elements.backendUrlInput) return false;

    const url = elements.backendUrlInput.value.trim();
    const isValid = url && (url.startsWith('http://') || url.startsWith('https://'));

    if (elements.testConnectionBtn) elements.testConnectionBtn.disabled = !isValid;
    if (elements.nextStep1Btn) elements.nextStep1Btn.disabled = !isValid;

    return isValid;
}

async function testConnection() {
    const url = elements.backendUrlInput?.value.trim();
    if (!url) {
        showStatus('Please enter backend URL', 'error');
        return;
    }

    elements.testConnectionBtn.disabled = true;
    elements.testConnectionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
    showStatus('Testing connection...', 'info');

    try {
        const result = await window.electronAPI.testConnection(url);

        if (result.success) {
            showStatus(`✅ Connected! ${result.data.status || 'OK'} v${result.data.version || '1.0.0'}`, 'success');
            if (elements.nextStep1Btn) {
                elements.nextStep1Btn.disabled = false;
            }
        } else {
            showStatus(`❌ Failed: ${result.error}`, 'error');
        }
    } catch (error) {
        showStatus(`❌ Error: ${error.message}`, 'error');
    } finally {
        elements.testConnectionBtn.disabled = false;
        elements.testConnectionBtn.innerHTML = '<i class="fas fa-wifi"></i> Test Connection';
    }
}

async function verifyLicense(licenseKey) {
    if (!backendURL) {
        updateLicenseStatus('Please set backend URL first', 'invalid');
        return;
    }

    try {
        updateLicenseStatus('Checking license...', 'loading');

        if (elements.departmentInput) {
            elements.departmentInput.disabled = true;
            elements.departmentInput.innerHTML = '<option value="">Checking license...</option>';
        }

        console.log('Verifying license:', licenseKey, 'at:', backendURL);

        const res = await fetch(`${backendURL}/api/company/verify/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                timestamp: new Date().toISOString(),
                licenseKey: licenseKey.trim()
            })
        });

        if (!res.ok) {
            throw new Error(`HTTP error! Status: ${res.status}`);
        }

        const data = await res.json();
        console.log('Full API response:', data);

        if (data.success && data.data) {
            companyData = data.data;
            populateCompanyData(data.data);
            updateLicenseStatus('✓ License verified', 'valid');

            if (data.data.company && data.data.company.name) {
                const companyNameInput = document.getElementById('companyName');
                if (!companyNameInput) {
                    const hiddenInput = document.createElement('input');
                    hiddenInput.type = 'hidden';
                    hiddenInput.id = 'companyName';
                    hiddenInput.value = data.data.company.name;
                    document.querySelector('#step-2').appendChild(hiddenInput);
                } else {
                    companyNameInput.value = data.data.company.name;
                }
            }

            return data;
        } else {
            const errorMsg = data.message || data.error || 'Invalid license key';
            throw new Error(errorMsg);
        }

    } catch (error) {
        console.error('Verify license error:', error);
        updateLicenseStatus('✗ ' + error.message, 'invalid');
        resetCompanyData();
        throw error;
    }
}

function updateLicenseStatus(message, type = 'info') {
    const statusElement = document.querySelector('.license-status');
    if (statusElement) {
        const icon = getStatusIcon(type);
        const iconElement = statusElement.querySelector('i');

        if (iconElement) {
            iconElement.className = `fas fa-${icon}`;
            if (type === 'loading') {
                iconElement.classList.add('fa-spin');
            } else {
                iconElement.classList.remove('fa-spin');
            }
        }

        statusElement.innerHTML = `<i class="fas fa-${icon}"></i> ${message}`;
        statusElement.className = `license-status ${type}`;
    }
}

function getStatusIcon(type) {
    switch (type) {
        case 'valid': return 'check-circle';
        case 'invalid': return 'exclamation-circle';
        case 'loading': return 'spinner';
        default: return 'info-circle';
    }
}

function populateCompanyData(data) {
    console.log('Populating ALL company data:', data);

    if (!data || !data.company) {
        console.error('No company data found in response');
        updateLicenseStatus('✗ No company data found', 'invalid');
        return;
    }

    const company = data.company;

    // Auto-fill semua field
    if (elements.companyNameInput && company.name) {
        elements.companyNameInput.value = company.name;
        elements.companyNameInput.disabled = false;
        elements.companyNameInput.readOnly = true;
        elements.companyNameInput.style.backgroundColor = '#f8f9fa';
    }

    if (elements.locationInput && company.address) {
        elements.locationInput.value = company.address;
        elements.locationInput.disabled = false;
        elements.locationInput.readOnly = true;
        elements.locationInput.style.backgroundColor = '#f8f9fa';
    }

    if (elements.emailInput && company.email) {
        elements.emailInput.value = company.email;
        elements.emailInput.disabled = false;
        elements.emailInput.readOnly = true;
        elements.emailInput.style.backgroundColor = '#f8f9fa';
    }

    if (elements.phoneInput && company.phone) {
        elements.phoneInput.value = company.phone;
        elements.phoneInput.disabled = false;
        elements.phoneInput.readOnly = true;
        elements.phoneInput.style.backgroundColor = '#f8f9fa';
    }

    if (elements.websiteInput && company.website) {
        elements.websiteInput.value = company.website;
        elements.websiteInput.disabled = false;
        elements.websiteInput.readOnly = true;
        elements.websiteInput.style.backgroundColor = '#f8f9fa';
    }

    // Simpan company ID
    const companyIdInput = document.getElementById('companyId');
    if (!companyIdInput) {
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.id = 'companyId';
        hiddenInput.value = company.id || '';
        document.querySelector('#step-2').appendChild(hiddenInput);
    } else {
        companyIdInput.value = company.id || '';
    }

    // Populate department dropdown
    const departments = data.departements || data.departments || [];

    if (elements.departmentInput && departments.length > 0) {
        elements.departmentInput.disabled = false;
        elements.departmentInput.innerHTML = '<option value="">-- Select Department --</option>';

        departments.forEach(dept => {
            const option = document.createElement('option');
            option.value = dept.id;
            option.textContent = dept.name;
            option.dataset.name = dept.name;
            elements.departmentInput.appendChild(option);
        });

        if (departments.length === 1) {
            elements.departmentInput.value = departments[0].id;
            setTimeout(() => {
                elements.departmentInput.dispatchEvent(new Event('change'));
            }, 100);
        }
    } else if (elements.departmentInput) {
        elements.departmentInput.innerHTML = '<option value="">No departments available</option>';
        elements.departmentInput.disabled = true;
    }

    if (company.name) {
        updateLicenseStatus(`✓ License verified for: ${company.name}`, 'valid');
    }

    setTimeout(validateStep2, 100);
}

function resetCompanyData() {
    const fieldsToReset = [
        { element: elements.companyNameInput, property: 'value' },
        { element: elements.locationInput, property: 'value' },
        { element: elements.emailInput, property: 'value' },
        { element: elements.phoneInput, property: 'value' },
        { element: elements.websiteInput, property: 'value' },
        { element: elements.departmentInput, property: 'innerHTML' }
    ];

    fieldsToReset.forEach(field => {
        if (field.element) {
            if (field.property === 'value') {
                field.element.value = '';
                field.element.disabled = true;
                field.element.readOnly = false;
                field.element.style.backgroundColor = '';
            } else if (field.property === 'innerHTML') {
                field.element.innerHTML = '<option value="">-- Enter valid license key --</option>';
                field.element.disabled = true;
            }
        }
    });

    const companyIdInput = document.getElementById('companyId');
    if (companyIdInput) {
        companyIdInput.value = '';
    }

    companyData = null;

    if (elements.nextStep2Btn) {
        elements.nextStep2Btn.disabled = true;
    }

    updateLicenseStatus('Enter your license key', 'info');
}

function validateStep2() {
    const licenseValid = companyData !== null;
    const departmentSelected = elements.departmentInput &&
        elements.departmentInput.value &&
        elements.departmentInput.value !== "";

    if (elements.nextStep2Btn) {
        const shouldEnable = licenseValid && departmentSelected;
        elements.nextStep2Btn.disabled = !shouldEnable;
    }

    return licenseValid && departmentSelected;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showStatus(message, type) {
    if (!elements.connectionStatus) return;

    elements.connectionStatus.textContent = message;
    elements.connectionStatus.className = `status-message ${type}`;
    elements.connectionStatus.classList.remove('hidden');
}

function updateReview() {
    console.log('Updating review with all data...');

    const companyId = document.getElementById('companyId')?.value || '';

    let departmentName = '';
    let departmentId = '';
    if (elements.departmentInput && elements.departmentInput.selectedOptions[0]) {
        const selectedOption = elements.departmentInput.selectedOptions[0];
        departmentName = selectedOption.dataset.name || selectedOption.textContent;
        departmentId = selectedOption.value;
    }

    const values = {
        backendUrl: elements.backendUrlInput?.value.trim() || '',
        companyName: elements.companyNameInput?.value || '',
        companyId: companyId,
        licenseKey: elements.companyInput?.value.trim() || '',
        location: elements.locationInput?.value || '',
        email: elements.emailInput?.value || '',
        phone: elements.phoneInput?.value || '',
        website: elements.websiteInput?.value || '',
        department: departmentName || '',
        departmentId: departmentId
    };

    // Update semua field
    if (elements.reviewBackendUrl) {
        elements.reviewBackendUrl.textContent = values.backendUrl;
    }

    if (elements.reviewCompanyName) {
        elements.reviewCompanyName.textContent = values.companyName || 'Not set';
    }

    if (elements.reviewCompanyId) {
        elements.reviewCompanyId.textContent = values.companyId || 'Not set';
    }

    if (elements.reviewLicenseKey) {
        elements.reviewLicenseKey.textContent = values.licenseKey || 'Not set';
    }

    if (elements.reviewLocation) {
        elements.reviewLocation.textContent = values.location || 'Not set';
    }

    if (elements.reviewEmail) {
        elements.reviewEmail.textContent = values.email || 'Not set';
    }

    if (elements.reviewPhone) {
        elements.reviewPhone.textContent = values.phone || 'Not set';
    }

    if (elements.reviewWebsite) {
        elements.reviewWebsite.textContent = values.website || 'Not set';
    }

    if (elements.reviewDepartment) {
        elements.reviewDepartment.textContent = values.department || 'Not set';
        if (values.departmentId) {
            elements.reviewDepartment.textContent += ` (ID: ${values.departmentId})`;
        }
    }
}

async function registerAgent() {
    console.log('📝 Starting registration...');

    if (!elements.registerBtn) return;

    elements.registerBtn.disabled = true;
    elements.registerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering...';

    if (elements.registrationMessages) {
        elements.registrationMessages.innerHTML = '';
    }

    if (!companyData) {
        alert('Please verify license key first');
        elements.registerBtn.disabled = false;
        elements.registerBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Register Agent';
        return;
    }

    let departmentId = '';
    let departmentName = '';
    if (elements.departmentInput && elements.departmentInput.selectedOptions[0]) {
        const selectedOption = elements.departmentInput.selectedOptions[0];
        departmentId = selectedOption.value;
        departmentName = selectedOption.dataset.name || selectedOption.textContent;
    } else {
        alert('Please select a department');
        elements.registerBtn.disabled = false;
        elements.registerBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Register Agent';
        return;
    }

    // System info - WAJIB diambil dari system
    const hostname = elements.systemHostnameSpan?.textContent || 'Unknown';
    const platform = elements.systemPlatformSpan?.textContent || 'win32';
    const macAddress = elements.systemMacSpan?.textContent || '00:00:00:00:00:00';

    // Company data
    const companyId = document.getElementById('companyId')?.value || '';
    const companyName = elements.companyNameInput?.value || '';
    const location = elements.locationInput?.value || '';
    const email = elements.emailInput?.value || '';
    const phone = elements.phoneInput?.value || '';
    const licenseKey = elements.companyInput?.value.trim() || '';

    // Kontak person (gunakan nama company jika tidak ada)
    const contactPerson = companyName || 'Admin';

    console.log('=== SYSTEM INFO ===');
    console.log('Hostname:', hostname);
    console.log('MAC Address:', macAddress);
    console.log('Contact Person:', contactPerson);
    console.log('Platform:', platform);

    // Generate agent ID yang lebih baik
    const agentId = `AGENT_${Math.random().toString(36).substr(2, 8).toUpperCase()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    console.log('=== DATA TO SEND ===');
    console.log('Backend URL:', backendURL);
    console.log('Agent ID:', agentId);
    console.log('Department ID:', departmentId);

    // Data yang DIKIRIM ke electron main process - SESUAI dengan yang diharapkan backend
    const registrationData = {
        // WAJIB: Untuk registrasi ke backend
        agent_id: agentId,
        name: agentId, // nama agent bisa sama dengan agent_id
        contact_person: contactPerson, // WAJIB: ini yang missing
        hostname: hostname, // WAJIB: sudah ada
        ip_address: '127.0.0.1',
        mac_address: macAddress, // WAJIB: sudah ada
        platform: platform.toLowerCase(),
        status: 'pending',

        // Company info WAJIB
        company_id: companyId,
        company_name: companyName,
        company_address: location,
        company_email: email,
        company_phone: phone,
        license_key: licenseKey,
        departement_id: parseInt(departmentId) || 0,

        // Untuk config agent 
        backend_url: backendURL,
        websocket_url: backendURL ? backendURL.replace('http', 'ws') + '/ws/agent' : 'ws://localhost:3001/ws/agent',

        // Metadata
        registered_at: new Date().toISOString(),
        agent_version: '1.0.0'
    };

    // DEBUG: Tampilkan semua data yang akan dikirim
    console.log('📦 COMPLETE REGISTRATION DATA:');
    console.log(JSON.stringify(registrationData, null, 2));

    updateProgress(10, 'Starting registration...');
    addMessage('Preparing registration data...', 'info');

    try {
        updateProgress(30, 'Testing connection...');
        addMessage(`Testing connection to ${backendURL}...`, 'info');

        // Test connection dulu
        const testResult = await window.electronAPI.testConnection(backendURL);
        if (!testResult.success) {
            throw new Error(`Connection failed: ${testResult.error}`);
        }
        addMessage('✅ Connection verified', 'success');

        updateProgress(60, 'Registering with backend...');
        addMessage('Sending registration to backend server...', 'info');

        console.log('Sending registration data to Electron:', registrationData);

        // Panggil electronAPI dengan data yang lengkap
        const result = await window.electronAPI.registerAgent(registrationData);

        console.log('Response from electronAPI:', result);

        if (!result.success) {
            throw new Error(result.error || 'Registration failed');
        }

        console.log('✅ Registration successful:', result);

        // Cek response dari backend
        if (!result.agent_id || !result.api_key) {
            throw new Error('Invalid response from server - missing agent_id or api_key');
        }

        updateProgress(80, 'Saving configuration...');
        addMessage('✅ Agent registered successfully!', 'success');
        addMessage(`Agent ID: ${result.agent_id}`, 'info');
        addMessage(`API Key: ${result.api_key.substring(0, 12)}...`, 'info');
        addMessage(`Company: ${companyName}`, 'info');

        // Simpan config ke local file
        const configData = {
            agentId: result.agent_id,
            apiKey: result.api_key,
            backendUrl: backendURL,
            // websocketUrl: backendURL.replace('http', 'ws') + '/ws/agent',
            websocketUrl: result.websocketUrl || `ws://${backendURL.replace('http://', '').split(':')[0]}:3001/ws/agent`,
            // websocketUrl: result.websocketUrl || backendURL.replace('http', 'ws') + '/ws/agent',

            hostname: hostname,
            macAddress: macAddress,
            platform: platform,
            ipAddress: '127.0.0.1',

            companyId: companyId,
            companyName: companyName,
            companyAddress: location,
            companyEmail: email,
            companyPhone: phone,
            licenseKey: licenseKey,

            departmentId: departmentId,
            departmentName: departmentName,
            contactPerson: contactPerson,

            status: 'active',
            configured: true,
            registeredAt: new Date().toISOString(),
            lastSeen: new Date().toISOString()
        };

        const configResult = await window.electronAPI.saveConfig(configData);

        if (!configResult.success) {
            throw new Error('Failed to save local configuration');
        }

        updateProgress(100, 'Registration complete!');
        addMessage('✅ Configuration saved locally', 'success');
        addMessage('✅ Agent ready to connect', 'success');

        // Show success screen
        setTimeout(() => {
            showSuccessScreen(result.agent_id, {
                agentId: result.agent_id,
                apiKey: result.api_key.substring(0, 12) + '...',
                // websocketUrl: backendURL.replace('http', 'ws') + '/ws/agent',
                websocketUrl: result.websocketUrl || `ws://${backendURL.replace('http://', '').split(':')[0]}:3001/ws/agent`,
                backendUrl: backendURL,
                companyName: companyName,
                departmentName: departmentName,
                hostname: hostname,
                platform: platform,
                contactPerson: contactPerson,
                registeredAt: new Date().toLocaleString()
            });
        }, 1000);

    } catch (error) {
        console.error('❌ Registration error:', error);
        updateProgress(0, 'Registration failed');
        addMessage(`❌ Error: ${error.message}`, 'error');
        addMessage('Please check that all required fields are filled', 'error');

        elements.registerBtn.disabled = false;
        elements.registerBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Register Agent';
    }
}

function updateProgress(percent, text) {
    if (elements.registrationProgress) {
        elements.registrationProgress.style.width = `${percent}%`;
    }
    if (elements.progressText) {
        elements.progressText.textContent = text;
    }
}

function addMessage(text, type) {
    if (!elements.registrationMessages) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = `${type === 'error' ? '❌' : '✅'} ${text}`;
    elements.registrationMessages.appendChild(messageDiv);
    elements.registrationMessages.scrollTop = elements.registrationMessages.scrollHeight;
}

function showSuccessScreen(agentId, responseData) {
    console.log('✅ Showing success screen');

    const step3Content = document.getElementById('step-3');
    if (step3Content) {
        step3Content.classList.remove('active');
    }

    elements.successScreen.classList.remove('hidden');
    elements.successScreen.classList.add('active');

    if (elements.successAgentId) {
        elements.successAgentId.textContent = responseData.agentId;
    }

    if (elements.successBackendUrl) {
        elements.successBackendUrl.textContent = responseData.backendUrl;
    }

    if (elements.successCompany) {
        elements.successCompany.textContent = responseData.companyName;
    }

    document.querySelectorAll('.step').forEach(stepEl => {
        const stepNum = parseInt(stepEl.dataset.step);
        stepEl.classList.add('completed');
    });

    console.log('✅ Registration completed!');
}

async function finishSetup() {
    console.log('✅ Setup complete! Starting agent and opening Device Info...');

    if (!elements.finishBtn) return;

    elements.finishBtn.disabled = true;
    elements.finishBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';

    try {
        // 1. Mulai agent service
        if (window.electronAPI && window.electronAPI.startAgent) {
            await window.electronAPI.startAgent();
            console.log('✅ Agent started');
        }

        // 2. Buka Device Info window
        if (window.electronAPI && window.electronAPI.openDeviceInfo) {
            console.log('🔄 Opening Device Info window...');
            await window.electronAPI.openDeviceInfo();
        } else {
            // Fallback: redirect ke device-info.html
            window.location.href = 'device-info.html';
        }

        // 3. Tunggu 5 detik lalu minimize ke tray
        setTimeout(() => {
            console.log('🕒 5 seconds passed, minimizing to tray...');

            if (window.electronAPI && window.electronAPI.minimizeToTray) {
                window.electronAPI.minimizeToTray();
            }

            // Tutup setup wizard window
            if (window.close) window.close();
        }, 5000);

    } catch (error) {
        console.error('❌ Error finishing setup:', error);
        showMessage(`Error: ${error.message}`, 'error');

        elements.finishBtn.disabled = false;
        elements.finishBtn.innerHTML = '<i class="fas fa-rocket"></i> Start Agent & Finish';
    }
}

