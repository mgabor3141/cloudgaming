const wakeButton = document.getElementById('wakeButton');
const messageDiv = document.getElementById('message');

wakeButton.addEventListener('click', async () => {
  // Disable button during request
  wakeButton.disabled = true;
  messageDiv.className = 'message';
  messageDiv.textContent = 'Sending wake signal...';
  messageDiv.style.display = 'block';

  try {
    const response = await fetch('/api/wake', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (data.success) {
      messageDiv.className = 'message success';
      messageDiv.textContent = data.message || 'Wake signal sent successfully!';
    } else {
      messageDiv.className = 'message error';
      messageDiv.textContent = data.error || 'Failed to send wake signal';
    }
  } catch (error) {
    messageDiv.className = 'message error';
    messageDiv.textContent = 'Network error: ' + error.message;
  } finally {
    // Re-enable button after request
    wakeButton.disabled = false;
    
    // Clear message after 5 seconds
    setTimeout(() => {
      messageDiv.style.display = 'none';
    }, 5000);
  }
});

