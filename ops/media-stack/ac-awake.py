#!/usr/bin/env python3
"""Hold logind's sleep/lid inhibitor only while an AC adapter is online."""
import glob, pathlib, subprocess, time
inhibitor = None
try:
    while True:
        on_ac = False
        for name in glob.glob('/sys/class/power_supply/*'):
            p = pathlib.Path(name)
            try:
                if (p / 'type').read_text().strip() in ('Mains', 'USB', 'USB_C') and (p / 'online').read_text().strip() == '1':
                    on_ac = True
            except OSError:
                pass
        if on_ac and (inhibitor is None or inhibitor.poll() is not None):
            inhibitor = subprocess.Popen(['systemd-inhibit', '--what=sleep:handle-lid-switch', '--who=Journal media', '--why=Media streaming on AC power', '--mode=block', 'sleep', 'infinity'])
        elif not on_ac and inhibitor is not None:
            inhibitor.terminate()
            inhibitor.wait(timeout=3)
            inhibitor = None
        time.sleep(3)
finally:
    if inhibitor is not None:
        inhibitor.terminate()
