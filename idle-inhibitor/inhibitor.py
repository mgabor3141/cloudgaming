#!/usr/bin/env python3
"""
Idle Inhibitor Service

Subscribes to a Wolf (or other) SSE event stream and maintains a systemd
idle inhibitor lock while events are flowing. Releases the lock after a
configurable idle period.

Uses D-Bus to communicate with systemd-logind, which is more reliable than
shelling out to systemd-inhibit, especially from a container.
"""

import os
import sys
import time
import signal
import logging
import threading
from typing import Optional
from contextlib import contextmanager

import requests
from dasbus.connection import SystemMessageBus
from dasbus.identifier import DBusServiceIdentifier

# Configuration from environment
SSE_URL = os.getenv("SSE_URL", "http://localhost/api/v1/events")
UNIX_SOCKET = os.getenv("UNIX_SOCKET", "/var/run/wolf/wolf.sock")
IDLE_TIMEOUT = int(os.getenv("IDLE_TIMEOUT", "300"))  # 5 minutes default
WHAT = os.getenv("WHAT", "sleep:idle")  # What to inhibit
WHY = os.getenv("WHY", "Wolf streaming session active")  # Reason
RECONNECT_DELAY = int(os.getenv("RECONNECT_DELAY", "5"))

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S'
)
logger = logging.getLogger(__name__)


class IdleInhibitor:
    """Manages systemd-logind inhibitor lock via D-Bus"""
    
    # D-Bus constants for systemd-logind
    LOGIND_SERVICE = "org.freedesktop.login1"
    LOGIND_PATH = "/org/freedesktop/login1"
    LOGIND_INTERFACE = "org.freedesktop.login1.Manager"
    
    def __init__(self, what: str = "sleep:idle", why: str = "Active session"):
        self.what = what
        self.why = why
        self.who = "idle-inhibitor"
        self.mode = "block"
        self.fd: Optional[int] = None
        self.bus = SystemMessageBus()
        self.lock = threading.Lock()
        
    def acquire(self) -> bool:
        """Acquire an inhibitor lock"""
        with self.lock:
            if self.fd is not None:
                return True  # Already held
                
            try:
                proxy = self.bus.get_proxy(
                    self.LOGIND_SERVICE,
                    self.LOGIND_PATH
                )
                
                # Call Inhibit method
                # Returns a file descriptor that holds the lock
                self.fd = proxy.Inhibit(self.what, self.who, self.why, self.mode)
                logger.info(f"Acquired inhibitor lock (fd={self.fd})")
                return True
                
            except Exception as e:
                logger.error(f"Failed to acquire inhibitor: {e}")
                return False
    
    def release(self):
        """Release the inhibitor lock"""
        with self.lock:
            if self.fd is not None:
                try:
                    os.close(self.fd)
                    logger.info("Released inhibitor lock")
                except Exception as e:
                    logger.error(f"Error releasing inhibitor: {e}")
                finally:
                    self.fd = None
    
    def is_held(self) -> bool:
        """Check if lock is currently held"""
        with self.lock:
            return self.fd is not None


class SSEMonitor:
    """Monitors SSE stream and manages idle timeout"""
    
    def __init__(self, inhibitor: IdleInhibitor):
        self.inhibitor = inhibitor
        self.timer: Optional[threading.Timer] = None
        self.timer_lock = threading.Lock()
        self.should_stop = threading.Event()
        
    def reset_idle_timer(self):
        """Reset the idle timeout timer"""
        with self.timer_lock:
            # Cancel existing timer
            if self.timer is not None:
                self.timer.cancel()
            
            # Start new timer
            self.timer = threading.Timer(IDLE_TIMEOUT, self._on_idle_timeout)
            self.timer.daemon = True
            self.timer.start()
    
    def _on_idle_timeout(self):
        """Called when idle timeout expires"""
        logger.info(f"Idle timeout ({IDLE_TIMEOUT}s) reached, releasing lock")
        self.inhibitor.release()
        with self.timer_lock:
            self.timer = None
    
    def cancel_timer(self):
        """Cancel the idle timer"""
        with self.timer_lock:
            if self.timer is not None:
                self.timer.cancel()
                self.timer = None
    
    def handle_event(self, line: str):
        """Process an SSE event line"""
        line = line.strip()
        
        # Ignore empty lines and comments
        if not line or line.startswith(':'):
            return
        
        # We consider any data line as activity
        if line.startswith('data:'):
            logger.debug(f"Activity detected: {line[:50]}...")
            
            # Acquire lock if not held
            if not self.inhibitor.is_held():
                self.inhibitor.acquire()
            
            # Reset idle timer
            self.reset_idle_timer()
    
    def connect_and_monitor(self) -> bool:
        """Connect to SSE stream and process events. Returns True on clean disconnect."""
        try:
            # Prepare request
            headers = {
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache'
            }
            
            # Create session with Unix socket if specified
            session = requests.Session()
            if UNIX_SOCKET:
                from requests_unixsocket import Session as UnixSession
                session = UnixSession()
                # Encode socket path for URL
                import urllib.parse
                socket_encoded = urllib.parse.quote(UNIX_SOCKET, safe='')
                url = f"http+unix://{socket_encoded}{SSE_URL.replace('http://localhost', '')}"
            else:
                url = SSE_URL
            
            logger.info(f"Connecting to {SSE_URL}...")
            
            # Stream with timeout
            response = session.get(
                url,
                headers=headers,
                stream=True,
                timeout=(10, None)  # 10s connect, no read timeout
            )
            response.raise_for_status()
            
            logger.info("Connected to SSE stream")
            
            # Process lines
            for line in response.iter_lines(decode_unicode=True):
                if self.should_stop.is_set():
                    logger.info("Stop signal received")
                    return True
                
                if line is not None:
                    self.handle_event(line)
            
            # Stream ended gracefully
            logger.info("SSE stream ended")
            return True
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Connection error: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            return False
    
    def stop(self):
        """Signal the monitor to stop"""
        self.should_stop.set()
        self.cancel_timer()


def signal_handler(signum, frame):
    """Handle shutdown signals"""
    logger.info(f"Received signal {signum}, shutting down...")
    sys.exit(0)


def main():
    """Main entry point"""
    logger.info("Idle Inhibitor Service starting...")
    logger.info(f"SSE URL: {SSE_URL}")
    logger.info(f"Unix Socket: {UNIX_SOCKET if UNIX_SOCKET else 'None'}")
    logger.info(f"Idle Timeout: {IDLE_TIMEOUT}s")
    logger.info(f"Inhibit: {WHAT}")
    
    # Setup signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Create inhibitor and monitor
    inhibitor = IdleInhibitor(what=WHAT, why=WHY)
    monitor = SSEMonitor(inhibitor)
    
    try:
        # Main loop with reconnection
        while True:
            success = monitor.connect_and_monitor()
            
            if monitor.should_stop.is_set():
                break
            
            # Reconnect delay
            logger.info(f"Reconnecting in {RECONNECT_DELAY}s...")
            time.sleep(RECONNECT_DELAY)
            
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    finally:
        monitor.stop()
        inhibitor.release()
        logger.info("Shutdown complete")


if __name__ == "__main__":
    main()

