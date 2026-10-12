const express = require('express');
const http = require('http');
const https = require('https');
const ws = require('ws');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const crypto = require('crypto');
const natUpnp = require('nat-upnp');

const PORT = 3000;
const upnpClient = natUpnp.createClient();

// Helper to open port 3000 on the router via UPnP
function mapPort() {
    console.log('UPnP: Attempting automatic port forwarding on your router for port 3000...');
    upnpClient.portMapping({
        public: PORT,
        private: PORT,
        ttl: 0 // Keep mapping alive until explicitly unmapped or router reboot
    }, (err) => {
        if (err) {
            console.warn('UPnP: Automatic port mapping failed. You may need to manually forward port 3000 on your router (this is normal if UPnP is disabled in your router settings).');
        } else {
            console.log(`UPnP: Successfully forwarded port ${PORT} on your router. It will close automatically when you stop the server.`);
        }
    });
}

// Helper to close port 3000 mapping on router
function unmapPort(callback) {
    console.log('UPnP: Closing port 3000 mapping on your router...');
    upnpClient.portUnmapping({
        public: PORT
    }, (err) => {
        if (err) {
            console.error('UPnP: Failed to delete port forwarding mapping on router:', err.message);
        } else {
            console.log('UPnP: Successfully deleted port forwarding mapping on router.');
        }
        if (callback) callback();
    });
}

// Check certificate availability at startup for HTTPS config
const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');
const useHttps = fs.existsSync(certPath) && fs.existsSync(keyPath);

const app = express();
app.use(express.json());

// Serve static UI folders
app.use('/host', express.static(path.join(__dirname)));
app.use('/guest', express.static(path.join(__dirname, '../guest')));

// Global configuration states
let runMode = 'qemu';
let qemuMemory = 25600; // 25 GB RAM

// Active invite tokens store
const activeTokens = new Set();
// Track connection states
let guestConnected = false;
let sandboxRunning = false;

// 1. Endpoint: Get current config
app.get('/api/config', (req, res) => {
    res.json({ runMode, qemuMemory });
});

// 2. Endpoint: Update config
app.post('/api/config', (req, res) => {
    if (req.body.runMode) runMode = req.body.runMode;
    if (req.body.qemuMemory) qemuMemory = parseInt(req.body.qemuMemory, 10);
    console.log(`Configuration updated: runMode=${runMode}, qemuMemory=${qemuMemory}MB`);
    res.json({ success: true, runMode, qemuMemory });
});

// 3. Endpoint: Check current status
app.get('/api/status', (req, res) => {
    if (runMode === 'qemu') {
        exec('pgrep -f "test-run.qcow2"', (err, stdout, stderr) => {
            sandboxRunning = stdout.trim().length > 0;
            res.json({
                sandboxRunning,
                guestConnected,
                activeTokensCount: activeTokens.size,
                runMode,
                qemuMemory
            });
        });
    } else {
        exec('docker ps --filter "name=guest-sandbox" --format "{{.Names}}"', (err, stdout, stderr) => {
            sandboxRunning = stdout.trim() === 'guest-sandbox';
            res.json({
                sandboxRunning,
                guestConnected,
                activeTokensCount: activeTokens.size,
                runMode,
                qemuMemory
            });
        });
    }
});

// Automates booting the Arch ISO in serial mode when QEMU starts
function automateBootloader() {
    console.log('Bootloader Automation: Waiting to connect to QEMU serial port on 5555...');
    let tcpSocket;
    let retries = 20;
    let buffer = '';
    let state = 'BOOTLOADER';

    const connect = () => {
        tcpSocket = net.connect({ host: '127.0.0.1', port: 5555 }, () => {
            console.log('Bootloader Automation: Connected successfully. Ready to inject serial console parameters.');
        });

        tcpSocket.on('data', (data) => {
            const str = data.toString();
            const cleanStr = str.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/\u001b\([a-zA-Z]/g, '');
            buffer += cleanStr;

            if (state === 'BOOTLOADER') {
                if (buffer.includes('Arch Linux install medium') || buffer.includes('Boot in') || buffer.includes('Arch Linux')) {
                    state = 'EDITING';
                    buffer = '';
                    setTimeout(() => {
                        console.log('Bootloader Automation: Sending "e" to edit boot parameters...');
                        if (tcpSocket.writable) tcpSocket.write('e');
                        
                        setTimeout(() => {
                            console.log('Bootloader Automation: Appending "console=ttyS0,115200" parameter...');
                            if (tcpSocket.writable) tcpSocket.write(' console=ttyS0,115200\n');
                            state = 'DONE';
                            tcpSocket.end();
                        }, 1500);
                    }, 1500);
                }
            }
        });

        tcpSocket.on('error', (err) => {
            if (retries > 0 && state === 'BOOTLOADER') {
                retries--;
                setTimeout(connect, 1000);
            } else {
                console.log('Bootloader Automation: Timeout or QEMU shut down.');
            }
        });
    };

    setTimeout(connect, 1000);
}

// 4. Endpoint: Start Environment (Docker or QEMU)
app.post('/api/start', (req, res) => {
    const freshDisk = req.query.fresh === 'true' || req.body.fresh === true;
    const diskOnly = req.query.diskOnly === 'true' || req.body.diskOnly === true;

    if (runMode === 'qemu') {
        console.log(`Starting QEMU VM (Memory=${qemuMemory}MB, fresh=${freshDisk}, diskOnly=${diskOnly})...`);
        const scriptPath = path.join(__dirname, '../sandbox/start-vm.sh');
        
        exec(`bash ${scriptPath} ${qemuMemory} ${freshDisk} ${diskOnly}`, (err, stdout, stderr) => {
            if (err) {
                console.error('Failed to start QEMU VM:', err, stderr);
                return res.status(500).json({ error: 'Failed to start QEMU VM', details: stderr });
            }
            console.log(stdout);
            sandboxRunning = true;
            
            // Trigger automatic bootloader console parameter injection if booting ISO
            if (!diskOnly) {
                automateBootloader();
            }
            
            res.json({ success: true, message: 'QEMU VM started successfully' });
        });
    } else {
        console.log('Starting Docker sandbox...');
        const scriptPath = path.join(__dirname, '../sandbox/start-sandbox.sh');
        exec(`bash ${scriptPath}`, (err, stdout, stderr) => {
            if (err) {
                console.error('Failed to start sandbox:', err, stderr);
                return res.status(500).json({ error: 'Failed to start sandbox container', details: stderr });
            }
            console.log(stdout);
            sandboxRunning = true;
            res.json({ success: true, message: 'Sandbox started successfully' });
        });
    }
});

// 5. Endpoint: Terminate Session
app.post('/api/stop', (req, res) => {
    console.log('Stopping current session...');
    if (runMode === 'qemu') {
        exec('pkill -f "test-run.qcow2" || true', (err, stdout, stderr) => {
            sandboxRunning = false;
            guestConnected = false;
            activeTokens.clear();
            res.json({ success: true, message: 'QEMU VM terminated successfully' });
        });
    } else {
        exec('docker stop guest-sandbox || true', (err, stdout, stderr) => {
            sandboxRunning = false;
            guestConnected = false;
            activeTokens.clear();
            res.json({ success: true, message: 'Sandbox terminated successfully' });
        });
    }
});

// 6. Endpoint: Generate Invite Code
app.post('/api/invite', (req, res) => {
    const token = crypto.randomBytes(16).toString('hex');
    activeTokens.add(token);
    console.log(`Generated new single-use token: ${token}`);
    
    const hostHeader = req.headers.host || 'localhost:3000';
    const protocol = useHttps ? 'https' : 'http';
    const inviteUrl = `${protocol}://${hostHeader}/guest/index.html#token=${token}`;
    
    res.json({ token, inviteUrl });
});

// 7. Endpoint: Copy host config files to mounted VM
app.post('/api/copy-configs', (req, res) => {
    const username = req.body.username || 'ethan';
    const targetDir = `/mnt/home/${username}`;
    
    console.log(`Copying configuration files to VM home directory for user ${username}...`);
    
    try {
        if (!fs.existsSync(targetDir)) {
            console.warn(`Target home directory ${targetDir} does not exist yet.`);
            return res.status(400).json({ error: `Target home directory ${targetDir} does not exist.` });
        }
        
        // Copy .bashrc
        const bashrcSource = path.join(__dirname, '../templates/bashrc');
        if (fs.existsSync(bashrcSource)) {
            console.log(`Copying ${bashrcSource} -> ${targetDir}/.bashrc`);
            fs.copyFileSync(bashrcSource, path.join(targetDir, '.bashrc'));
        }
        
        // Copy Hyprland config
        const hyprSource = path.join(__dirname, '../templates/hyprland.conf');
        const hyprTargetDir = path.join(targetDir, '.config/hypr');
        fs.mkdirSync(hyprTargetDir, { recursive: true });
        if (fs.existsSync(hyprSource)) {
            console.log(`Copying ${hyprSource} -> ${hyprTargetDir}/hyprland.conf`);
            fs.copyFileSync(hyprSource, path.join(hyprTargetDir, 'hyprland.conf'));
        }
        
        // Copy Kitty config
        const kittySource = path.join(__dirname, '../templates/kitty.conf');
        const kittyTargetDir = path.join(targetDir, '.config/kitty');
        fs.mkdirSync(kittyTargetDir, { recursive: true });
        if (fs.existsSync(kittySource)) {
            console.log(`Copying ${kittySource} -> ${kittyTargetDir}/kitty.conf`);
            fs.copyFileSync(kittySource, path.join(kittyTargetDir, 'kitty.conf'));
        }
        
        // Change ownership to the guest user (assumes first normal user is UID/GID 1000)
        exec(`chown -R 1000:1000 ${targetDir}`, (err) => {
            if (err) {
                console.error('Failed to change ownership of copied configs:', err);
            } else {
                console.log(`Successfully updated ownership of copied files in ${targetDir}`);
            }
        });
        
        res.json({ success: true, message: 'Configuration files copied successfully.' });
    } catch (err) {
        console.error('Error copying configuration files:', err);
        res.status(500).json({ error: 'Failed to copy configs', details: err.message });
    }
});

// Create HTTP or HTTPS server based on certificate availability
let server;
if (useHttps) {
    console.log('SSL certificates detected. Running native HTTPS/WSS server...');
    server = https.createServer({
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    }, app);
} else {
    console.log('No SSL certificates found. Running HTTP/WS server (insecure over WAN)...');
    server = http.createServer(app);
}

// Attach WebSocket servers on /vnc and /serial paths
const wss = new ws.Server({ noServer: true });
const wssSerial = new ws.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    
    if (url.pathname === '/vnc') {
        const token = url.searchParams.get('token');
        const isHost = token === 'host-view';
        
        if (!isHost && (!token || !activeTokens.has(token))) {
            console.log('Rejected unauthorized VNC WebSocket connection (invalid token).');
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        wss.handleUpgrade(request, socket, head, (wsConnection) => {
            if (!isHost) {
                activeTokens.delete(token); // Invalidate token (single-use)
            }
            wss.emit('connection', wsConnection, request);
        });
    } else if (url.pathname === '/serial') {
        const token = url.searchParams.get('token');
        const isHost = token === 'host-view';
        
        if (!isHost && (!token || !activeTokens.has(token))) {
            console.log('Rejected unauthorized Serial WebSocket connection (invalid token).');
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        wssSerial.handleUpgrade(request, socket, head, (wsConnection) => {
            wssSerial.emit('connection', wsConnection, request);
        });
    } else {
        socket.destroy();
    }
});

// VNC WebSocket Connection Handling
wss.on('connection', (wsConnection, req) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');
    const isHost = token === 'host-view';

    if (isHost) {
        console.log('Host dashboard VNC monitor connected. Establishing mirror tunnel...');
    } else {
        console.log('Guest VNC WebSocket handshake completed. Establishing VNC tunnel...');
        guestConnected = true;
    }

    let tcpSocket;
    let retries = 5;
    const connectToVnc = () => {
        tcpSocket = net.connect({ host: '127.0.0.1', port: 5900 }, () => {
            console.log('Proxy tunnel: Connected to VNC server.');
        });

        tcpSocket.on('data', (data) => {
            if (wsConnection.readyState === ws.OPEN) {
                wsConnection.send(data);
            }
        });

        tcpSocket.on('error', (err) => {
            console.error(`VNC socket error: ${err.message}`);
            if (retries > 0) {
                retries--;
                console.log(`VNC server not ready yet. Retrying in 1 second (${retries} attempts left)...`);
                setTimeout(connectToVnc, 1000);
            } else {
                wsConnection.close();
            }
        });

        tcpSocket.on('close', () => {
            console.log('VNC socket closed.');
            wsConnection.close();
        });
    };

    connectToVnc();

    wsConnection.on('message', (message) => {
        if (tcpSocket && tcpSocket.writable) {
            tcpSocket.write(message);
        }
    });

    wsConnection.on('close', () => {
        if (isHost) {
            console.log('Host VNC monitor disconnected.');
        } else {
            console.log('Guest VNC disconnected.');
            guestConnected = false;
        }
        if (tcpSocket) {
            tcpSocket.end();
        }
    });
});

// Serial WebSocket Connection Handling
wssSerial.on('connection', (wsConnection, req) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');
    const isHost = token === 'host-view';

    console.log(`Serial console WebSocket connected (${isHost ? 'Host' : 'Guest'}). Establishing TCP tunnel...`);

    let tcpSocket;
    let retries = 15;
    const connectToSerial = () => {
        tcpSocket = net.connect({ host: '127.0.0.1', port: 5555 }, () => {
            console.log('Proxy tunnel: Connected to serial redirection port (5555).');
        });

        tcpSocket.on('data', (data) => {
            if (wsConnection.readyState === ws.OPEN) {
                wsConnection.send(data.toString());
            }
        });

        tcpSocket.on('error', (err) => {
            console.error(`Serial socket error: ${err.message}`);
            if (retries > 0) {
                retries--;
                console.log(`Serial server not ready yet. Retrying in 1 second (${retries} attempts left)...`);
                setTimeout(connectToSerial, 1000);
            } else {
                wsConnection.close();
            }
        });

        tcpSocket.on('close', () => {
            console.log('Serial socket closed.');
            wsConnection.close();
        });
    };

    connectToSerial();

    wsConnection.on('message', (message) => {
        if (tcpSocket && tcpSocket.writable) {
            tcpSocket.write(message);
        }
    });

    wsConnection.on('close', () => {
        console.log('Serial WebSocket disconnected.');
        if (tcpSocket) {
            tcpSocket.end();
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    const protocol = useHttps ? 'https' : 'http';
    console.log(`====================================================`);
    console.log(`Safe VM sharing server is running on port ${PORT}`);
    console.log(`Host Interface: ${protocol}://localhost:${PORT}/host/index.html`);
    console.log(`====================================================`);
    
    // Trigger router port mapping for remote guest access
    mapPort();
});

// Graceful shutdown handler to clean up Docker/QEMU and close open router ports
function gracefulShutdown() {
    console.log('\nGracefully shutting down PortaVM host server...');
    
    // Terminate QEMU
    exec('pkill -f "test-run.qcow2" || true', () => {
        // Stop docker sandbox container if it is running
        exec('docker stop guest-sandbox || true', (err) => {
            unmapPort(() => {
                console.log('Teardown complete. Exiting.');
                process.exit(0);
            });
        });
    });
}

// Register process exit listeners for termination signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
