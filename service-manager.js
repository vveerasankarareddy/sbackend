const { spawn } = require('child_process');
const fs = require('fs-extra');
const servicesConfig = require('./config/services.config');

const PID_FILE = './pids.json';

class ServiceManager {
  constructor() {
    this.services = {};
    servicesConfig.services.forEach(service => {
      this.services[service.name] = service;
    });
    this.pids = fs.existsSync(PID_FILE) ? fs.readJsonSync(PID_FILE) : {};
  }

  savePids() {
    fs.writeJsonSync(PID_FILE, this.pids);
  }

  startService(serviceName) {
    if (this.pids[serviceName]) {
      console.log(`Service ${serviceName} already running with PID ${this.pids[serviceName]}`);
      return;
    }
    const service = this.services[serviceName];
    if (!service) {
      console.log(`Service ${serviceName} not found`);
      return;
    }
    const child = spawn('node', [service.path], { detached: true, stdio: 'inherit' });
    child.unref();
    this.pids[serviceName] = child.pid;
    this.savePids();
    console.log(`Started ${serviceName} with PID ${child.pid}`);
  }

  stopService(serviceName) {
    const pid = this.pids[serviceName];
    if (!pid) {
      console.log(`Service ${serviceName} not running`);
      return;
    }
    try {
      process.kill(pid, 'SIGTERM');
      delete this.pids[serviceName];
      this.savePids();
      console.log(`Stopped ${serviceName}`);
    } catch (err) {
      console.log(`Failed to stop ${serviceName}: ${err.message}`);
    }
  }

  restartService(serviceName) {
    this.stopService(serviceName);
    setTimeout(() => this.startService(serviceName), 1000);
  }

  startAll() {
    Object.keys(this.services).forEach(serviceName => this.startService(serviceName));
  }

  getServices() {
    return this.services;
  }
}

module.exports = new ServiceManager();