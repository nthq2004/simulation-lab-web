export class DeviceManager {
    constructor(sys) {
        this.sys = sys;
        this.devices = new Map();
    }

    register(device) {
        this.devices.set(device.id, device);
        return device;
    }

    get(id) {
        return this.devices.get(id) || null;
    }

    getOrCreate(id, DeviceClass) {
        let dev = this.devices.get(id);
        if (!dev) {
            dev = new DeviceClass({ id });
            this.register(dev);
        }
        return dev;
    }

    remove(id) {
        const dev = this.devices.get(id);
        if (dev) {
            dev.destroy?.();
            this.devices.delete(id);
        }
    }

    getAll() {
        return Array.from(this.devices.values());
    }

    tick(dt) {
        this.devices.forEach(dev => dev.preUpdate(dt));
        this.devices.forEach(dev => dev.commit());
    }
}