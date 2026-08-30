import dgram from 'node:dgram';
import { isIP } from 'node:net';
import { config } from './config.js';

export function normalizeMac(value) {
  const compact = value.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  if (!/^[a-f0-9]{12}$/.test(compact)) throw new Error('MAC address must contain exactly 12 hexadecimal characters');
  return compact;
}

export async function wakeDevice(macValue, broadcast = config.wakeBroadcast) {
  if (!macValue) throw new Error('A target MAC address is required');
  if (isIP(broadcast) !== 4) throw new Error('Broadcast must be a valid IPv4 address');
  const mac = Buffer.from(normalizeMac(macValue), 'hex');
  const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => mac)]);
  await new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', (error) => { socket.close(); reject(error); });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 9, broadcast, (error) => {
        socket.close();
        if (error) reject(error); else resolve();
      });
    });
  });
}
