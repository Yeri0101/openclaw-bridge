// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('power-toggle');
  const statusText = document.getElementById('status-text');

  // Cargar estado inicial
  chrome.storage.local.get(['bridgeEnabled'], (result) => {
    // Por defecto encendido si nunca se configuró
    const isEnabled = result.bridgeEnabled !== false; 
    toggle.checked = isEnabled;
    updateUI(isEnabled);
  });

  // Al cambiar el toggle
  toggle.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.local.set({ bridgeEnabled: isEnabled }, () => {
      updateUI(isEnabled);
    });
  });

  function updateUI(isEnabled) {
    if (isEnabled) {
      statusText.textContent = "Conectado al servidor";
      statusText.style.color = "#059669"; // Emerald 600
    } else {
      statusText.textContent = "Apagado (Ignorando órdenes)";
      statusText.style.color = "#ef4444"; // Red 500
    }
  }
});
