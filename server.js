const serviceManager = require('./service-manager');
const readline = require('readline');

serviceManager.startAll();
console.log('All services started. Enter commands (e.g., stop auth-service, restart auth-service):');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on('line', (input) => {
  const [command, serviceName, ...args] = input.trim().split(' ');
  switch (command) {
    case 'stop':
      serviceManager.stopService(serviceName);
      break;
    case 'restart':
      serviceManager.restartService(serviceName);
      break;
    case 'start':
      serviceManager.startService(serviceName);
      break;
    default:
      console.log('Unknown command. Use: start <service>, stop <service>, restart <service>');
  }
});

rl.on('close', () => {
  console.log('Shutting down...');
  Object.keys(serviceManager.getServices()).forEach(serviceName => serviceManager.stopService(serviceName));
  process.exit(0);
});