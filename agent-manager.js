import axios from 'axios';
import ConfigManager from './config-manager.js';

class AgentManager {
  async testConnection(backendUrl) {
    try {
      const response = await axios.get(`${backendUrl}/api/health`, { timeout: 5000 });
      return {
        success: true,
        data: response.data,
        version: response.data.version,
        status: response.data.status
      };
    } catch (error) {
      throw new Error(`Cannot connect to backend: ${error.message}`);
    }
  }

  async registerAgent(agentData) {
    try {
      const response = await axios.post(`${agentData.backendUrl}/api/agents/register`, {
        ...agentData,
        platform: process.platform,
        arch: process.arch
      }, { timeout: 10000 });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Registration failed');
      }

      // SIMPAN DENGAN API KEY YANG BENAR
      const config = ConfigManager.saveConfig({
        ...agentData,
        agentId: response.data.agentId,
        agentToken: response.data.agentToken,
        apiKey: response.data.apiKey,
        backendUrl: agentData.backendUrl,
        websocketUrl: response.data.websocketUrl
      });

      return {
        success: true,
        agentId: response.data.agentId,
        config: config  // ← KIRIM BALIK CONFIG LENGKAP
      };

    } catch (error) {
      console.error('Registration error:', error);
      throw new Error(`Registration failed: ${error.message}`);
    }
  }

  async checkAgentStatus(backendUrl, agentId, agentToken) {
    try {
      const response = await axios.get(`${backendUrl}/api/agents/${agentId}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
        timeout: 5000
      });

      return {
        success: true,
        data: response.data,
        status: response.data.agent.status,
        printers: response.data.printers
      };
    } catch (error) {
      throw new Error(`Cannot check agent status: ${error.message}`);
    }
  }

  async syncWithBackend() {
    const config = ConfigManager.getConfig();
    if (!config) throw new Error('Agent not configured');

    try {
      const response = await axios.post(
        `${config.backendUrl}/api/agents/${config.agentId}/heartbeat`,
        { timestamp: new Date().toISOString() },
        {
          headers: { Authorization: `Bearer ${config.agentToken}` },
          timeout: 5000
        }
      );

      ConfigManager.updateConfig({ lastSync: new Date().toISOString() });
      return response.data;
    } catch (error) {
      console.error('Sync error:', error);
      throw error;
    }
  }
}

export default new AgentManager();