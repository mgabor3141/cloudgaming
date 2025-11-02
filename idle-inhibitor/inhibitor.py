#!/usr/bin/env python3
"""
Idle Inhibitor Service

Subscribes to a Wolf (or other) SSE event stream and maintains a systemd
idle inhibitor lock while events are flowing. Releases the lock after a
configurable idle period.

Uses systemd-inhibit command which is the most reliable method from containers.
"""

import os
import sys
import time
import signal
import logging
import threading
import subprocess
from typing import Optional

import requests

# Configuration from environment
SSE_URL = os.getenv("SSE_URL", "http://localhost/api/v1/events")
UNIX_SOCKET = os.getenv("UNIX_SOCKET", "/var/run/wolf/wolf.sock")
IDLE_TIMEOUT = int(os.getenv("IDLE_TIMEOUT", "300"))  # 5 minutes default
WHAT = os.getenv("WHAT", "idle:sleep")  # What to inhibit
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
    """Manages systemd-logind inhibitor lock via systemd-inhibit command"""
    
    def __init__(self, what: str = "idle:sleep", why: str = "Active session"):
        self.what = what
        self.why = why
        self.who = "idle-inhibitor"
        self.process: Optional[subprocess.Popen] = None
        self.lock = threading.Lock()
        
    def acquire(self) -> bool:
        """Acquire an inhibitor lock by spawning systemd-inhibit process"""
        with self.lock:
            if self.process is not None:
                return True  # Already held
                
            try:
                # Use systemd-inhibit to run a sleep command that we can keep alive
                # The lock is held as long as the process runs
                cmd = [
                    'systemd-inhibit',
                    f'--what={self.what}',
                    f'--who={self.who}',
                    f'--why={self.why}',
                    '--mode=block',
                    'sleep', 'infinity'
                ]
                
                logger.info(f"Acquiring inhibitor lock: {' '.join(cmd)}")
                
                # Start the process
                self.process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    stdin=subprocess.DEVNULL
                )
                
                # Give it a moment to start and check if it's still running
                time.sleep(0.1)
                if self.process.poll() is not None:
                    # Process died immediately
                    stdout, stderr = self.process.communicate()
                    logger.error(f"systemd-inhibit failed to start:")
                    logger.error(f"stdout: {stdout.decode()}")
                    logger.error(f"stderr: {stderr.decode()}")
                    self.process = None
                    return False
                
                logger.info(f"Acquired inhibitor lock (pid={self.process.pid})")
                return True
                
            except Exception as e:
                logger.error(f"Failed to acquire inhibitor: {e}", exc_info=True)
                self.process = None
                return False
    
    def release(self):
        """Release the inhibitor lock by terminating the process"""
        with self.lock:
            if self.process is not None:
                try:
                    logger.info(f"Releasing inhibitor lock (pid={self.process.pid})")
                    self.process.terminate()
                    
                    # Wait for it to exit (with timeout)
                    try:
                        self.process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        logger.warning("Process didn't terminate, killing it")
                        self.process.kill()
                        self.process.wait()
                    
                    logger.info("Released inhibitor lock")
                except Exception as e:
                    logger.error(f"Error releasing inhibitor: {e}")
                finally:
                    self.process = None
    
    def is_held(self) -> bool:
        """Check if lock is currently held"""
        with self.lock:
            if self.process is None:
                return False
            
            # Check if process is still running
            if self.process.poll() is not None:
                logger.warning("Inhibitor process died unexpectedly")
                self.process = None
                return False
            
            return True


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
                try:
                    from requests_unixsocket import Session as UnixSession
                    session = UnixSession()
                    # Encode socket path for URL
                    import urllib.parse
                    socket_encoded = urllib.parse.quote(UNIX_SOCKET, safe='')
                    url = f"http+unix://{socket_encoded}{SSE_URL.replace('http://localhost', '')}"
                except ImportError:
                    logger.warning("requests-unixsocket not available, using HTTP")
                    url = SSE_URL
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
            logger.error(f"Unexpected error: {e}", exc_info=True)
            return False
    
    def stop(self):
        """Signal the monitor to stop"""
        self.should_stop.set()
        self.cancel_timer()


def signal_handler(signum, frame):
    """Handle shutdown signals"""
    logger.info(f"Received signal {signum}, shutting down...")
    # Don't call sys.exit here, let main() handle cleanup
    raise KeyboardInterrupt


def main():
    """Main entry point"""
    logger.info("Idle Inhibitor Service starting...")
    logger.info(f"SSE URL: {SSE_URL}")
    logger.info(f"Unix Socket: {UNIX_SOCKET if UNIX_SOCKET else 'None'}")
    logger.info(f"Idle Timeout: {IDLE_TIMEOUT}s")
    logger.info(f"Inhibit: {WHAT}")
    logger.info(f"Reason: {WHY}")
    
    # Check if systemd-inhibit is available
    try:
        result = subprocess.run(
            ['systemd-inhibit', '--version'],
            capture_output=True,
            timeout=5
        )
        if result.returncode != 0:
            logger.error("systemd-inhibit command not available or not working")
            logger.error(f"stderr: {result.stderr.decode()}")
            sys.exit(1)
        logger.info(f"systemd version: {result.stdout.decode().split()[0]}")
    except Exception as e:
        logger.error(f"Failed to check systemd-inhibit availability: {e}")
        sys.exit(1)
    
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
