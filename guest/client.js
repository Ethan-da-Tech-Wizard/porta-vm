import RFB from 'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.5.0/core/rfb.js';

// DOM Elements
const overlay = document.getElementById('overlay');
const tokenInput = document.getElementById('tokenInput');
const connectBtn = document.getElementById('connectBtn');
const statusMsg = document.getElementById('statusMsg');

const workspaceContainer = document.getElementById('workspace-container');
const viewport = document.getElementById('viewport');
const vncTarget = document.getElementById('vnc-target');
const dualVncTargets = document.getElementById('dual-vnc-targets');
const vncTarget1 = document.getElementById('vnc-target-1');
const vncTarget2 = document.getElementById('vnc-target-2');

const singleScreenBtn = document.getElementById('singleScreenBtn');
const dualScreenBtn = document.getElementById('dualScreenBtn');
const screenToggleBtn = document.getElementById('screenToggleBtn');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const cadBtn = document.getElementById('cadBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');

const wizardSidebar = document.getElementById('wizardSidebar');
const serialConsoleLog = document.getElementById('serialConsoleLog');

// Wizard controls
const targetDiskInput = document.getElementById('targetDisk');
const vmHostnameInput = document.getElementById('vmHostname');
const vmUsernameInput = document.getElementById('vmUsername');
const vmPasswordInput = document.getElementById('vmPassword');

const btnStep1 = document.getElementById('btn-step1');
const btnStep2 = document.getElementById('btn-step2');
const btnStep3 = document.getElementById('btn-step3');
const btnStep4 = document.getElementById('btn-step4');
const btnStep5 = document.getElementById('btn-step5');
const btnStep6 = document.getElementById('btn-step6');

const cardStep1 = document.getElementById('step1-card');
const cardStep2 = document.getElementById('step2-card');
const cardStep3 = document.getElementById('step3-card');
const cardStep4 = document.getElementById('step4-card');
const cardStep5 = document.getElementById('step5-card');
const cardStep6 = document.getElementById('step6-card');

const statusStep1 = document.getElementById('step1-status');
const statusStep2 = document.getElementById('step2-status');
const statusStep3 = document.getElementById('step3-status');
const statusStep4 = document.getElementById('step4-status');
const statusStep5 = document.getElementById('step5-status');
const statusStep6 = document.getElementById('step6-status');

// Session states
let token = '';
let rfbInstance = null;
let rfbInstance1 = null;
let rfbInstance2 = null;
let serialSocket = null;
let isDualScreen = false;
let resizeObserver2 = null;
let activeScreen = 1; // 1 or 2 — which screen is shown in single-screen mode
let resizeObserverSingle = null; // for single screen canvas offset

// Wizard runner states
let commandQueue = [];
let queueIndex = 0;
let runInProgress = false;
let serialBuffer = '';
let currentOnComplete = null;

function setStatus(text, type = 'info') {
    statusMsg.innerText = text;
    statusMsg.className = 'status-message';
    if (type === 'error') statusMsg.classList.add('status-error');
    if (type === 'info') statusMsg.classList.add('status-info');
    if (type === 'success') statusMsg.classList.add('status-success');
}

function extractTokenFromHash() {
    const hash = window.location.hash;
    if (hash && hash.includes('token=')) {
        const extracted = hash.split('token=')[1];
        if (extracted) {
            tokenInput.value = extracted;
            setStatus('Invite token detected in URL. Ready to connect.', 'success');
        }
    }
}

// Log directly into the serial console panel
function logSerial(msg) {
    serialConsoleLog.innerText += msg;
    serialConsoleLog.scrollTop = serialConsoleLog.scrollHeight;
}

// Main Connection Manager
function connectSession() {
    token = tokenInput.value.trim();
    if (!token) {
        setStatus('Please enter a valid invite token.', 'error');
        return;
    }

    setStatus('Connecting to remote gateway...', 'info');
    connectBtn.disabled = true;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsVncUrl = `${protocol}//${window.location.host}/vnc?token=${encodeURIComponent(token)}`;
    const wsSerialUrl = `${protocol}//${window.location.host}/serial?token=${encodeURIComponent(token)}`;

    try {
        // 1. Establish Serial Console connection
        serialSocket = new WebSocket(wsSerialUrl);
        serialSocket.onopen = () => {
            logSerial('\n*** Serial Console Attached ***\n');
        };
        serialSocket.onmessage = (e) => {
            const cleanMsg = e.data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            logSerial(cleanMsg);
            
            serialBuffer += cleanMsg;
            if (runInProgress) {
                // Check if prompt returns (ends with # after root@archiso or similar)
                if (serialBuffer.includes('root@archiso') && serialBuffer.trim().endsWith('#')) {
                    setTimeout(sendNextCommand, 300);
                }
            }
        };
        serialSocket.onclose = () => {
            logSerial('\n*** Serial Console Detached ***\n');
            serialSocket = null;
        };

        // 2. Establish VNC display connection
        initVncDisplays(wsVncUrl);

    } catch (err) {
        console.error('Connection setup failed:', err);
        setStatus(`Setup Error: ${err.message}`, 'error');
        connectBtn.disabled = false;
    }
}

function initVncDisplays(wsVncUrl) {
    disconnectVncDisplays();

    const credentialsHandler = (rfb) => {
        rfb.sendCredentials({ username: '', password: '' });
    };

    if (isDualScreen) {
        vncTarget.style.display = 'none';
        dualVncTargets.style.display = 'grid';

        rfbInstance1 = new RFB(vncTarget1, wsVncUrl);
        rfbInstance1.scaleViewport = true;
        rfbInstance1.focusOnClick = true;

        rfbInstance2 = new RFB(vncTarget2, wsVncUrl);
        rfbInstance2.scaleViewport = true;
        rfbInstance2.focusOnClick = true;

        rfbInstance1.addEventListener('connect', onVncConnect);
        rfbInstance1.addEventListener('credentialsrequired', () => credentialsHandler(rfbInstance1));
        rfbInstance1.addEventListener('disconnect', onVncDisconnect);

        rfbInstance2.addEventListener('credentialsrequired', () => credentialsHandler(rfbInstance2));
        rfbInstance2.addEventListener('connect', () => {
            console.log('Display 2 attached. Initializing dynamic cropping shifts.');
            const canvas = vncTarget2.querySelector('canvas');
            if (canvas) {
                canvas.style.position = 'absolute';
                const updatePos = () => {
                    const width = canvas.offsetWidth || canvas.width;
                    canvas.style.left = `-${width / 2}px`;
                };
                updatePos();
                resizeObserver2 = new ResizeObserver(updatePos);
                resizeObserver2.observe(canvas);
            }
        });

    } else {
        dualVncTargets.style.display = 'none';
        vncTarget.style.display = 'block';

        rfbInstance = new RFB(vncTarget, wsVncUrl);
        rfbInstance.scaleViewport = true;
        rfbInstance.focusOnClick = true;

        rfbInstance.addEventListener('connect', () => {
            onVncConnect();
            // After connect, apply the active screen canvas offset
            applySingleScreenOffset();
        });
        rfbInstance.addEventListener('credentialsrequired', () => credentialsHandler(rfbInstance));
        rfbInstance.addEventListener('disconnect', onVncDisconnect);
    }
}

function onVncConnect() {
    setStatus('Connection established successfully!', 'success');
    overlay.classList.add('hidden');
    setTimeout(() => {
        overlay.style.display = 'none';
        workspaceContainer.style.display = 'flex';
    }, 300);
}

function onVncDisconnect(e) {
    console.log('VNC disconnected:', e);
    const cleanDisconnect = e.detail.clean;

    if (cleanDisconnect) {
        setStatus('Session disconnected.', 'info');
    } else {
        setStatus('Tunnel connection lost. The token might have expired or VM stopped.', 'error');
    }

    workspaceContainer.style.display = 'none';
    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.remove('hidden'), 50);
    connectBtn.disabled = false;

    disconnectVncDisplays();
    if (serialSocket) {
        serialSocket.close();
        serialSocket = null;
    }
}

function disconnectVncDisplays() {
    if (rfbInstance) {
        rfbInstance.disconnect();
        rfbInstance = null;
    }
    if (rfbInstance1) {
        rfbInstance1.disconnect();
        rfbInstance1 = null;
    }
    if (rfbInstance2) {
        rfbInstance2.disconnect();
        rfbInstance2 = null;
    }
    if (resizeObserver2) {
        resizeObserver2.disconnect();
        resizeObserver2 = null;
    }
    vncTarget.innerHTML = '';
    vncTarget1.innerHTML = '';
    vncTarget2.innerHTML = '';
}

function applySingleScreenOffset() {
    if (resizeObserverSingle) {
        resizeObserverSingle.disconnect();
        resizeObserverSingle = null;
    }
    const canvas = vncTarget.querySelector('canvas');
    if (!canvas) return;

    canvas.style.position = 'absolute';
    const updateOffset = () => {
        const width = canvas.offsetWidth || canvas.width || 1280;
        if (activeScreen === 2) {
            // Shift canvas left by half its width to show the right (second) display
            canvas.style.left = `-${width / 2}px`;
        } else {
            canvas.style.left = '0px';
        }
    };
    updateOffset();
    resizeObserverSingle = new ResizeObserver(updateOffset);
    resizeObserverSingle.observe(canvas);
}

function setActiveScreen(num) {
    activeScreen = num;
    if (screenToggleBtn) screenToggleBtn.textContent = `Active: Screen ${num}`;
    if (!isDualScreen) applySingleScreenOffset();
}

function setDualDisplayMode(enable) {
    if (isDualScreen === enable) return;
    isDualScreen = enable;

    if (enable) {
        singleScreenBtn.classList.remove('active');
        dualScreenBtn.classList.add('active');
        if (screenToggleBtn) screenToggleBtn.style.display = 'none';
    } else {
        dualScreenBtn.classList.remove('active');
        singleScreenBtn.classList.add('active');
        if (screenToggleBtn) screenToggleBtn.style.display = 'flex';
    }

    if (rfbInstance || rfbInstance1) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsVncUrl = `${protocol}//${window.location.host}/vnc?token=${encodeURIComponent(token)}`;
        initVncDisplays(wsVncUrl);
    }
}

// Collapsible Sidebar toggling
function setSidebarCollapsed(collapsed) {
    if (collapsed) {
        wizardSidebar.classList.add('collapsed');
        toggleSidebarBtn.classList.remove('active');
    } else {
        wizardSidebar.classList.remove('collapsed');
        toggleSidebarBtn.classList.add('active');
    }
}

// Wizard Command Runner Logic
function runCommandSequence(commands, onComplete) {
    if (runInProgress) return;
    commandQueue = commands;
    queueIndex = 0;
    runInProgress = true;
    currentOnComplete = onComplete;
    
    logSerial('\n=== Starting installation wizard sequence ===\n');
    sendNextCommand();
}

function sendNextCommand() {
    if (queueIndex >= commandQueue.length) {
        runInProgress = false;
        logSerial('\n=== Step completed successfully! ===\n');
        if (currentOnComplete) currentOnComplete();
        return;
    }

    const cmd = commandQueue[queueIndex++];
    logSerial(`\n[Wizard Runner] Sending: ${cmd}\n`);
    serialBuffer = '';
    
    if (serialSocket && serialSocket.readyState === WebSocket.OPEN) {
        serialSocket.send(cmd + '\n');
    } else {
        logSerial('\n❌ Error: Serial console tunnel is closed!\n');
        runInProgress = false;
    }
}

// Bind Wizard Buttons
btnStep1.addEventListener('click', () => {
    const disk = targetDiskInput.value.trim();
    if (!disk) return alert('Specify a disk device (e.g. /dev/vda)');

    btnStep1.disabled = true;
    cardStep1.classList.add('active');
    statusStep1.innerHTML = '⚡';

    const cmds = [
        `sgdisk -Z ${disk}`,
        `sgdisk -n 1:0:+512M -t 1:ef00 -c 1:EFI -n 2:0:0 -t 2:8300 -c 2:root ${disk}`,
        `partprobe ${disk}`
    ];

    runCommandSequence(cmds, () => {
        cardStep1.classList.remove('active');
        cardStep1.classList.add('completed');
        statusStep1.innerHTML = '✅';
        btnStep2.disabled = false;
        cardStep2.classList.add('active');
    });
});

btnStep2.addEventListener('click', () => {
    const disk = targetDiskInput.value.trim();
    btnStep2.disabled = true;
    cardStep2.classList.remove('active');
    cardStep2.classList.add('active');
    statusStep2.innerHTML = '⚡';

    const cmds = [
        `mkfs.fat -F 32 ${disk}1`,
        `mkfs.ext4 -F ${disk}2`,
        `mount ${disk}2 /mnt`,
        `mkdir -p /mnt/boot`,
        `mount ${disk}1 /mnt/boot`
    ];

    runCommandSequence(cmds, () => {
        cardStep2.classList.remove('active');
        cardStep2.classList.add('completed');
        statusStep2.innerHTML = '✅';
        btnStep3.disabled = false;
        cardStep3.classList.add('active');
    });
});

btnStep3.addEventListener('click', () => {
    btnStep3.disabled = true;
    cardStep3.classList.remove('active');
    cardStep3.classList.add('active');
    statusStep3.innerHTML = '⚡';

    // Bootstrap packages
    const cmds = [
        'pacstrap -K /mnt base linux linux-firmware nano networkmanager sudo'
    ];

    runCommandSequence(cmds, () => {
        cardStep3.classList.remove('active');
        cardStep3.classList.add('completed');
        statusStep3.innerHTML = '✅';
        btnStep4.disabled = false;
        cardStep4.classList.add('active');
    });
});

btnStep4.addEventListener('click', () => {
    const host = vmHostnameInput.value.trim();
    const user = vmUsernameInput.value.trim();
    const pass = vmPasswordInput.value.trim();

    if (!host || !user || !pass) {
        return alert('Please fill in all system configuration fields.');
    }

    btnStep4.disabled = true;
    cardStep4.classList.remove('active');
    cardStep4.classList.add('active');
    statusStep4.innerHTML = '⚡';

    const cmds = [
        'genfstab -U /mnt >> /mnt/etc/fstab',
        'arch-chroot /mnt ln -sf /usr/share/zoneinfo/America/Phoenix /etc/localtime',
        'arch-chroot /mnt hwclock --systohc',
        'arch-chroot /mnt sh -c "sed -i \'s/#en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/\' /etc/locale.gen"',
        'arch-chroot /mnt locale-gen',
        'arch-chroot /mnt sh -c \'echo "LANG=en_US.UTF-8" > /etc/locale.conf\'',
        `arch-chroot /mnt sh -c 'echo "${host}" > /etc/hostname'`,
        `arch-chroot /mnt sh -c 'echo -e "rootpass\\nrootpass" | passwd'`,
        `arch-chroot /mnt useradd -m -G wheel -s /bin/bash ${user}`,
        `arch-chroot /mnt sh -c 'echo -e "${pass}\\n${pass}" | passwd ${user}'`,
        `arch-chroot /mnt sh -c 'echo "%wheel ALL=(ALL:ALL) ALL" >> /etc/sudoers'`,
        'arch-chroot /mnt systemctl enable NetworkManager'
    ];

    runCommandSequence(cmds, () => {
        cardStep4.classList.remove('active');
        cardStep4.classList.add('completed');
        statusStep4.innerHTML = '✅';
        btnStep5.disabled = false;
        cardStep5.classList.add('active');
    });
});

btnStep5.addEventListener('click', () => {
    const disk = targetDiskInput.value.trim();
    btnStep5.disabled = true;
    cardStep5.classList.remove('active');
    cardStep5.classList.add('active');
    statusStep5.innerHTML = '⚡';

    const cmds = [
        'arch-chroot /mnt bootctl install',
        'arch-chroot /mnt sh -c \'echo -e "default arch.conf\\ntimeout 5\\nconsole-mode keep\\neditor no" > /boot/loader/loader.conf\'',
        `arch-chroot /mnt sh -c 'root_uuid=\$(blkid -s UUID -o value ${disk}2) && echo -e "title Arch Linux\\nlinux /vmlinuz-linux\\ninitrd /initramfs-linux.img\\noptions root=UUID=\$root_uuid rw" > /boot/loader/entries/arch.conf'`,
        // Install Hyprland and greeter
        'arch-chroot /mnt pacman -S --noconfirm xorg-xwayland hyprland kitty lightdm lightdm-gtk-greeter',
        'arch-chroot /mnt systemctl enable lightdm'
    ];

    runCommandSequence(cmds, async () => {
        logSerial('\n[Wizard] Copying configuration files (.bashrc, hyprland, kitty) from host...\n');
        try {
            const res = await fetch('/api/copy-configs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: vmUsernameInput.value.trim() })
            });
            const data = await res.json();
            if (data.success) {
                logSerial('[Wizard] Configurations cloned successfully.\n');
            } else {
                logSerial(`[Wizard] Warning: config clone returned: ${data.error}\n`);
            }
        } catch (err) {
            logSerial(`[Wizard] Warning: failed to contact config clone API: ${err.message}\n`);
        }

        cardStep5.classList.remove('active');
        cardStep5.classList.add('completed');
        statusStep5.innerHTML = '✅';
        btnStep6.disabled = false;
        cardStep6.classList.add('active');
    });
});

btnStep6.addEventListener('click', async () => {
    btnStep6.disabled = true;
    cardStep6.classList.remove('active');
    cardStep6.classList.add('active');
    statusStep6.innerHTML = '⚡';

    const cmds = [
        'umount -R /mnt',
        'poweroff'
    ];

    runCommandSequence(cmds, async () => {
        cardStep6.classList.remove('active');
        cardStep6.classList.add('completed');
        statusStep6.innerHTML = '✅';
        logSerial('\n*** Installation complete! Powering off ISO. ***\n');
        logSerial('\n*** rebooting into installed Arch Linux disk... ***\n');
        
        // Wait 3 seconds, then hit /api/start with diskOnly=true
        setTimeout(async () => {
            try {
                logSerial('Booting direct virtual disk session...\n');
                const res = await fetch('/api/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ diskOnly: true })
                });
                const data = await res.json();
                if (data.success) {
                    logSerial('VM is starting in Disk Only mode. The screen should reconnect shortly.\n');
                }
            } catch (err) {
                console.error(err);
            }
        }, 3000);
    });
});

// Event Listeners for top control bar
singleScreenBtn.addEventListener('click', () => setDualDisplayMode(false));
dualScreenBtn.addEventListener('click', () => setDualDisplayMode(true));
if (screenToggleBtn) {
    screenToggleBtn.addEventListener('click', () => {
        // Cycle between Screen 1 and Screen 2
        setActiveScreen(activeScreen === 1 ? 2 : 1);
    });
}
toggleSidebarBtn.addEventListener('click', () => {
    const isCollapsed = wizardSidebar.classList.contains('collapsed');
    setSidebarCollapsed(!isCollapsed);
});
closeSidebarBtn.addEventListener('click', () => setSidebarCollapsed(true));

disconnectBtn.addEventListener('click', () => {
    disconnectVncDisplays();
    if (serialSocket) {
        serialSocket.close();
    }
});

cadBtn.addEventListener('click', () => {
    const rfb = rfbInstance || rfbInstance1;
    if (rfb) {
        rfb.sendCtrlAltDel();
    }
});

fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        viewport.requestFullscreen().catch((err) => console.error(err));
    } else {
        document.exitFullscreen();
    }
});

document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.style.color = document.fullscreenElement ? 'var(--color-success)' : '';
});

// Init on page load
window.addEventListener('DOMContentLoaded', () => {
    extractTokenFromHash();
    connectBtn.addEventListener('click', connectSession);
    tokenInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') connectSession();
    });

    // ── Sidebar Drag-Resize ────────────────────────────────────────────────
    // Works on Windows (mouse + trackpad + touch) via Pointer Events API
    const resizeHandle = document.getElementById('resize-handle');
    const sidebar = document.getElementById('wizardSidebar');
    const workspaceEl = document.getElementById('workspace-container');

    if (resizeHandle && sidebar) {
        let dragging = false;

        resizeHandle.addEventListener('pointerdown', (e) => {
            // Only respond to primary pointer (left mouse / first touch)
            if (e.button !== undefined && e.button !== 0) return;
            dragging = true;
            resizeHandle.setPointerCapture(e.pointerId);
            resizeHandle.classList.add('dragging');
            // Disable text selection while dragging
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
        });

        resizeHandle.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            // Calculate new sidebar width: distance from right edge of window to pointer
            const containerRect = workspaceEl.getBoundingClientRect();
            const newWidth = Math.max(260, Math.min(600, containerRect.right - e.clientX));
            sidebar.style.setProperty('--sidebar-width', `${newWidth}px`);
            sidebar.style.width = `${newWidth}px`;
        });

        const stopDrag = () => {
            if (!dragging) return;
            dragging = false;
            resizeHandle.classList.remove('dragging');
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        };

        resizeHandle.addEventListener('pointerup', stopDrag);
        resizeHandle.addEventListener('pointercancel', stopDrag);
    }
});
