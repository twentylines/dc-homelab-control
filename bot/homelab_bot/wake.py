import asyncio
import ipaddress
import re
import socket
from pathlib import Path

from .state import read_json, write_json


def normalise_mac(value):
    text = re.sub(r"[:-]", "", str(value)).lower()
    if not re.fullmatch(r"[a-f0-9]{12}", text):
        raise ValueError("Enter a MAC address containing exactly 12 hexadecimal digits")
    return text


class Wake:
    def __init__(self, cfg):
        self.cfg = cfg
        self.path = Path(cfg.get("WAKE_FAVORITES_FILE", str(cfg.data_dir / "wake-favorites.json")))

    def favorites(self):
        result = read_json(self.path)
        if not isinstance(result, dict):
            raise ValueError("Saved wake favourites must be a JSON object")
        label, mac = self.cfg.get("WAKE_DEFAULT_LABEL"), self.cfg.get("WAKE_DEFAULT_MAC")
        if label and mac and label not in result:
            result[label] = {
                "mac": mac,
                "broadcast": self.cfg.get("WAKE_BROADCAST", "255.255.255.255"),
            }
        return result

    async def send(self, mac, broadcast=None):
        mac = bytes.fromhex(normalise_mac(mac))
        address = broadcast or self.cfg.get("WAKE_BROADCAST", "255.255.255.255")
        try:
            ipaddress.IPv4Address(address)
        except ipaddress.AddressValueError as exc:
            raise ValueError("Wake broadcast must be an IPv4 address") from exc
        packet = b"\xff" * 6 + mac * 16

        def send_packet():
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                sock.settimeout(3)
                sock.sendto(packet, (address, 9))

        await asyncio.to_thread(send_packet)

    def save(self, label, mac, broadcast=None):
        label = re.sub(r"[\r\n`*_@]", "", label).strip()[:48]
        if not label:
            raise ValueError("A favourite label is required")
        state = self.favorites()
        state[label] = {
            "mac": normalise_mac(mac),
            "broadcast": broadcast or self.cfg.get("WAKE_BROADCAST", "255.255.255.255"),
        }
        write_json(self.path, state)
