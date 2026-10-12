#!/bin/bash
# Script to launch QEMU VM with dual screens and serial console redirection
set -e

DISK_PATH="/home/ethan/porta-vm/vm/test-run.qcow2"
VARS_PATH="/home/ethan/porta-vm/vm/OVMF_VARS-test-run.fd"
ISO_PATH="/home/ethan/porta-vm/iso/archlinux-2026.07.01-x86_64.iso"
if [ ! -f "$ISO_PATH" ]; then
    ISO_PATH="/home/ethan/ARCH-AI/iso/archlinux-2026.07.01-x86_64.iso"
fi
CODE_PATH="/usr/share/edk2/x64/OVMF_CODE.4m.fd"

# Arguments
MEMORY=${1:-25600}
FRESH_DISK=${2:-"false"}
BOOT_DISK_ONLY=${3:-"false"}

echo "=== PortaVM QEMU Manager ==="
echo "Memory: ${MEMORY}MB"
echo "Fresh Disk: ${FRESH_DISK}"
echo "Boot Disk Only: ${BOOT_DISK_ONLY}"

# Check directories
mkdir -p "/home/ethan/porta-vm/vm"

# Clean up or recreate disk if starting fresh
if [ "$FRESH_DISK" == "true" ] || [ ! -f "$DISK_PATH" ]; then
    echo "Creating fresh 25G qcow2 virtual disk..."
    rm -f "$DISK_PATH" "$VARS_PATH" || true
    qemu-img create -f qcow2 "$DISK_PATH" 25G
    cp /usr/share/edk2/x64/OVMF_VARS.4m.fd "$VARS_PATH"
fi

# Ensure vars file exists
if [ ! -f "$VARS_PATH" ]; then
    cp /usr/share/edk2/x64/OVMF_VARS.4m.fd "$VARS_PATH"
fi

# Stop any running instances of qemu-system-x86_64 running this VM
if pgrep -f "test-run.qcow2" > /dev/null; then
    echo "Stopping existing QEMU instance..."
    pkill -f "test-run.qcow2" || true
    sleep 1.5
fi

# Build QEMU command line arguments
QEMU_ARGS=(
  -enable-kvm
  -cpu host
  -smp 4
  -m "$MEMORY"
  -machine q35
  -drive "if=pflash,format=raw,readonly=on,file=$CODE_PATH"
  -drive "if=pflash,format=raw,file=$VARS_PATH"
  -device virtio-scsi-pci,id=scsi0
  -drive "file=$DISK_PATH,format=qcow2,if=none,id=drive0"
  -device scsi-hd,drive=drive0
  -device virtio-gpu-pci,max_outputs=2
  -vnc 127.0.0.1:0
  -serial tcp:127.0.0.1:5555,server,nowait
  -net nic,model=virtio
  -net user,hostfwd=tcp::2222-:22
  -device intel-hda -device hda-duplex
  -daemonize
)

# Append CDROM if not booting from installed disk only
if [ "$BOOT_DISK_ONLY" != "true" ]; then
    echo "Attaching installer ISO..."
    QEMU_ARGS+=(-cdrom "$ISO_PATH" -boot menu=on,strict=on)
fi

echo "Launching QEMU VM in background..."
qemu-system-x86_64 "${QEMU_ARGS[@]}"

echo "QEMU VM started successfully."
echo "VNC server listening on 127.0.0.1:5900 (Display :0)"
echo "Serial console redirect server listening on 127.0.0.1:5555"
