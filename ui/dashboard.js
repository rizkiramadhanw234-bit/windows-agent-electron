import { ipcRenderer } from 'electron';

class Dashboard {
    constructor() {
        this.currentPage = 'overview';
        this.chart = null;
        this.logsPaused = false;
        this.autoScroll = true;
        
        this.init();
    }
    
    init() {
        this.loadConfig();
        this.bindEvents();
        this.updateTime();
        this.loadAgentInfo();
        this.startLiveUpdates();
    }
    
    loadConfig() {
        // Load saved config from main process
        ipcRenderer.invoke('get-config').then(config => {
            if (config) {
                this.updateConfigDisplay(config);
            }
        });
    }
    
    bindEvents() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const page = item.dataset.page;
                this.switchPage(page);
            });
        });
        
        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.refreshCurrentPage();
        });
        
        // Settings button
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.switchPage('settings');
        });
        
        // Overview page
        document.getElementById('chartPeriod').addEventListener('change', (e) => {
            this.loadChartData(e.target.value);
        });
        
        document.getElementById('viewAllJobs').addEventListener('click', () => {
            this.switchPage('jobs');
        });
        
        // Printers page
        document.getElementById('scanPrintersBtn').addEventListener('click', () => {
            this.scanPrinters();
        });
        
        // Jobs page
        document.getElementById('applyFilter').addEventListener('click', () => {
            this.filterJobs();
        });
        
        // Ink page
        document.getElementById('checkInkBtn').addEventListener('click', () => {
            this.checkInkLevels();
        });
        
        // Logs page
        document.getElementById('logLevel').addEventListener('change', (e) => {
            this.filterLogs(e.target.value);
        });
        
        document.getElementById('clearLogsBtn').addEventListener('click', () => {
            this.clearLogs();
        });
        
        document.getElementById('exportLogsBtn').addEventListener('click', () => {
            this.exportLogs();
        });
        
        document.getElementById('pauseLogsBtn').addEventListener('click', () => {
            this.toggleLogsPause();
        });
        
        document.getElementById('autoScrollBtn').addEventListener('click', () => {
            this.toggleAutoScroll();
        });
        
        // Settings page tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchSettingsTab(tab);
            });
        });
        
        // Settings actions
        document.getElementById('saveSettingsBtn').addEventListener('click', () => {
            this.saveSettings();
        });
        
        document.getElementById('cancelSettingsBtn').addEventListener('click', () => {
            this.switchPage('overview');
        });
        
        document.getElementById('testConnectionBtn2').addEventListener('click', () => {
            this.testConnection();
        });
        
        // IPC listeners
        ipcRenderer.on('agent-log', (event, log) => {
            this.addLogEntry(log, 'info');
        });
        
        ipcRenderer.on('agent-error', (event, error) => {
            this.addLogEntry(error, 'error');
        });
        
        ipcRenderer.on('agent-status', (event, status) => {
            this.updateAgentStatus(status);
        });
        
        ipcRenderer.on('printer-update', (event, printers) => {
            this.updatePrintersList(printers);
        });
        
        ipcRenderer.on('job-update', (event, jobs) => {
            this.updateJobsList(jobs);
        });
    }
    
    switchPage(page) {
        // Update navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });
        
        // Update page title
        const titles = {
            overview: 'Dashboard Overview',
            printers: 'Printers Monitoring',
            jobs: 'Print Jobs History',
            ink: 'Ink & Toner Levels',
            logs: 'Agent Logs',
            settings: 'Agent Settings'
        };
        
        document.getElementById('pageTitle').textContent = titles[page] || page;
        
        // Update breadcrumb
        const breadcrumb = document.getElementById('breadcrumb');
        breadcrumb.innerHTML = `<span>Home</span> / <span>${titles[page] || page}</span>`;
        
        // Hide all pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('active');
        });
        
        // Show selected page
        const pageElement = document.getElementById(`${page}-page`);
        if (pageElement) {
            pageElement.classList.add('active');
            
            // Load page-specific data
            this.loadPageData(page);
        }
        
        this.currentPage = page;
    }
    
    loadPageData(page) {
        switch(page) {
            case 'overview':
                this.loadOverviewData();
                break;
            case 'printers':
                this.loadPrintersData();
                break;
            case 'jobs':
                this.loadJobsData();
                break;
            case 'ink':
                this.loadInkData();
                break;
            case 'logs':
                this.loadLogs();
                break;
            case 'settings':
                this.loadSettings();
                break;
        }
    }
    
    loadOverviewData() {
        // Load stats
        ipcRenderer.invoke('get-stats').then(stats => {
            if (stats) {
                this.updateOverviewStats(stats);
            }
        });
        
        // Load chart
        this.loadChartData(7);
        
        // Load recent jobs
        this.loadRecentJobs();
        
        // Load printer status
        this.loadPrinterStatus();
    }
    
    updateOverviewStats(stats) {
        document.getElementById('totalPrinters').textContent = stats.totalPrinters || 0;
        document.getElementById('todayJobs').textContent = stats.todayJobs || 0;
        document.getElementById('totalPages').textContent = stats.totalPages || 0;
        document.getElementById('totalIssues').textContent = stats.totalIssues || 0;
        
        // Update change indicators
        if (stats.printerChange > 0) {
            document.getElementById('printerChange').textContent = `+${stats.printerChange} today`;
            document.getElementById('printerChange').className = 'change-up';
        } else if (stats.printerChange < 0) {
            document.getElementById('printerChange').textContent = `${stats.printerChange} today`;
            document.getElementById('printerChange').className = 'change-down';
        } else {
            document.getElementById('printerChange').textContent = 'No change';
            document.getElementById('printerChange').className = 'change-neutral';
        }
    }
    
    loadChartData(days) {
        // Fetch chart data from main process
        ipcRenderer.invoke('get-chart-data', days).then(data => {
            this.renderChart(data);
        });
    }
    
    renderChart(data) {
        const ctx = document.getElementById('printChart');
        
        if (this.chart) {
            this.chart.destroy();
        }
        
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels || [],
                datasets: [{
                    label: 'Print Jobs',
                    data: data.jobs || [],
                    borderColor: '#007bff',
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    tension: 0.4,
                    fill: true
                }, {
                    label: 'Total Pages',
                    data: data.pages || [],
                    borderColor: '#28a745',
                    backgroundColor: 'rgba(40, 167, 69, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }
    
    loadRecentJobs() {
        ipcRenderer.invoke('get-recent-jobs', 10).then(jobs => {
            this.updateRecentJobsTable(jobs);
        });
    }
    
    updateRecentJobsTable(jobs) {
        const tbody = document.getElementById('recentJobsBody');
        
        if (!jobs || jobs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state">No print jobs yet</td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = jobs.map(job => `
            <tr>
                <td>${job.printer || 'Unknown'}</td>
                <td>${job.user || 'System'}</td>
                <td>${job.pages || 1}</td>
                <td>${this.formatTime(job.time)}</td>
                <td>
                    <span class="status-badge ${job.status || 'completed'}">
                        ${job.status || 'Completed'}
                    </span>
                </td>
            </tr>
        `).join('');
    }
    
    loadPrinterStatus() {
        ipcRenderer.invoke('get-printer-status').then(printers => {
            this.updatePrinterStatusList(printers);
        });
    }
    
    updatePrinterStatusList(printers) {
        const container = document.getElementById('printerStatusList');
        
        if (!printers || printers.length === 0) {
            container.innerHTML = '<div class="empty-state">No printer data available</div>';
            return;
        }
        
        container.innerHTML = printers.map(printer => `
            <div class="status-item">
                <div class="status-icon ${printer.status || 'unknown'}">
                    <i class="fas fa-print"></i>
                </div>
                <div class="status-details">
                    <div class="status-name">${printer.name}</div>
                    <div class="status-info">
                        <span class="status-text">${printer.status || 'Unknown'}</span>
                        <span class="separator">•</span>
                        <span class="status-jobs">${printer.jobs || 0} jobs</span>
                        <span class="separator">•</span>
                        <span class="status-pages">${printer.pages || 0} pages</span>
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    scanPrinters() {
        document.getElementById('scanPrintersBtn').disabled = true;
        document.getElementById('scanPrintersBtn').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...';
        
        ipcRenderer.invoke('scan-printers').then(result => {
            document.getElementById('scanPrintersBtn').disabled = false;
            document.getElementById('scanPrintersBtn').innerHTML = '<i class="fas fa-sync"></i> Scan Printers';
            
            if (result.success) {
                this.loadPrintersData();
            }
        });
    }
    
    loadPrintersData() {
        ipcRenderer.invoke('get-printers').then(printers => {
            this.updatePrintersGrid(printers);
        });
    }
    
    updatePrintersGrid(printers) {
        const grid = document.getElementById('printersGrid');
        
        if (!printers || printers.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-print fa-3x"></i>
                    <h3>No printers found</h3>
                    <p>Click "Scan Printers" to discover printers on your network</p>
                </div>
            `;
            return;
        }
        
        grid.innerHTML = printers.map(printer => `
            <div class="printer-card ${printer.status || 'unknown'}">
                <div class="printer-header">
                    <div class="printer-icon">
                        <i class="fas fa-print"></i>
                    </div>
                    <div class="printer-info">
                        <h3>${printer.name}</h3>
                        <span class="printer-model">${printer.model || 'Unknown model'}</span>
                    </div>
                    <div class="printer-status">
                        <span class="status-badge ${printer.status || 'unknown'}">
                            ${printer.status || 'Unknown'}
                        </span>
                    </div>
                </div>
                
                <div class="printer-details">
                    <div class="detail-item">
                        <span class="detail-label">IP Address:</span>
                        <span class="detail-value">${printer.ip || 'N/A'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Location:</span>
                        <span class="detail-value">${printer.location || 'N/A'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Total Jobs:</span>
                        <span class="detail-value">${printer.totalJobs || 0}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Total Pages:</span>
                        <span class="detail-value">${printer.totalPages || 0}</span>
                    </div>
                </div>
                
                <div class="printer-actions">
                    <button class="btn btn-small btn-secondary" data-printer="${printer.name}">
                        <i class="fas fa-chart-bar"></i> Details
                    </button>
                    <button class="btn btn-small btn-primary" data-printer="${printer.name}">
                        <i class="fas fa-sync"></i> Refresh
                    </button>
                </div>
            </div>
        `).join('');
    }
    
    loadAgentInfo() {
        ipcRenderer.invoke('get-config').then(config => {
            if (config) {
                document.getElementById('agentIdDisplay').textContent = config.agentId || '-';
                document.getElementById('backendUrlDisplay').textContent = config.backendUrl || '-';
                document.getElementById('lastSyncDisplay').textContent = config.lastSync ? 
                    new Date(config.lastSync).toLocaleString() : '-';
                document.getElementById('versionDisplay').textContent = config.version || '1.0.0';
                
                // Update user info
                document.getElementById('userName').textContent = config.contactPerson || config.company || 'System';
                document.getElementById('userRole').textContent = config.department || 'Local Agent';
            }
        });
        
        // Get agent status
        ipcRenderer.invoke('get-agent-status').then(status => {
            this.updateAgentStatus(status);
        });
    }
    
    updateAgentStatus(status) {
        const indicator = document.getElementById('agentStatusIndicator');
        const text = document.getElementById('agentStatusText');
        const footerStatus = document.getElementById('footerStatus');
        
        if (status.isRunning) {
            indicator.className = 'status-indicator online';
            text.textContent = 'Online';
            footerStatus.textContent = 'Status: Online';
        } else {
            indicator.className = 'status-indicator offline';
            text.textContent = 'Offline';
            footerStatus.textContent = 'Status: Offline';
        }
    }
    
    addLogEntry(message, level = 'info') {
        if (this.logsPaused) return;
        
        const logsView = document.getElementById('logsView');
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        
        const time = new Date().toLocaleString();
        logEntry.innerHTML = `
            <span class="log-time">[${time}]</span>
            <span class="log-level ${level}">[${level.toUpperCase()}]</span>
            <span class="log-message">${message}</span>
        `;
        
        logsView.appendChild(logEntry);
        
        if (this.autoScroll) {
            logsView.scrollTop = logsView.scrollHeight;
        }
    }
    
    updateTime() {
        const timeElement = document.getElementById('currentTime');
        const update = () => {
            const now = new Date();
            timeElement.textContent = now.toLocaleTimeString();
        };
        
        update();
        setInterval(update, 1000);
        
        // Update memory usage
        setInterval(() => {
            if (window.performance && window.performance.memory) {
                const memory = window.performance.memory;
                const usedMB = Math.round(memory.usedJSHeapSize / 1048576);
                document.getElementById('memoryUsage').textContent = `Memory: ${usedMB} MB`;
            }
        }, 5000);
    }
    
    startLiveUpdates() {
        // Request updates every 30 seconds
        setInterval(() => {
            if (this.currentPage === 'overview') {
                this.loadOverviewData();
            }
            this.loadAgentInfo();
        }, 30000);
    }
    
    formatTime(dateString) {
        if (!dateString) return 'N/A';
        
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        
        // If less than 1 minute
        if (diff < 60000) {
            return 'Just now';
        }
        
        // If less than 1 hour
        if (diff < 3600000) {
            const minutes = Math.floor(diff / 60000);
            return `${minutes}m ago`;
        }
        
        // If today
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }
        
        // Otherwise show date
        return date.toLocaleDateString();
    }
    
    // ... tambahkan method lainnya sesuai kebutuhan
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new Dashboard();
});