document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('videoFile');
  const format = document.getElementById('format').value;
  const compression = document.getElementById('compression').value;
  if (!fileInput.files.length) return alert('Please select a video file');

  const formData = new FormData();
  formData.append('video', fileInput.files[0]);
  formData.append('format', format);
  formData.append('compression', compression);

  // Show progress UI
  document.getElementById('progressContainer').classList.remove('hidden');
  document.getElementById('statusText').textContent = 'Uploading...';

  const uploadResp = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });
  const { jobId } = await uploadResp.json();

  // Listen for progress via SSE
  const evtSource = new EventSource(`/api/progress/${jobId}`);
  const progressBar = document.getElementById('progressBar');
  const statusText = document.getElementById('statusText');
  let downloadKey = null;

  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.status === 'processing') {
        // Simulate progress increment
        const current = parseInt(progressBar.style.width) || 0;
        const next = Math.min(current + 20, 90);
        progressBar.style.width = `${next}%`;
        statusText.textContent = 'Processing...';
      } else if (data.status === 'done') {
        progressBar.style.width = '100%';
        statusText.textContent = 'Conversion complete!';
        downloadKey = data.resultKey;
        evtSource.close();
        // Show download link
        const dlLink = document.getElementById('downloadLink');
        dlLink.href = `/api/download/${downloadKey}`;
        document.getElementById('downloadLinkContainer').classList.remove('hidden');
      }
    } catch (err) {
      console.error('Invalid SSE data', err);
    }
  };
});
