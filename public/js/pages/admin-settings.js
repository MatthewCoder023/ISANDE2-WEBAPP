/** System settings (admin): store info, GCash details, operations. */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';

const form = document.querySelector('#settings-form');

async function loadSettings() {
  try {
    const { data } = await api('/api/settings');
    const s = data.settings;
    form.shopName.value = s.shopName;
    form.addressLine.value = s.addressLine;
    form.phone.value = s.phone;
    form.gcashNumber.value = s.gcashNumber;
    form.gcashName.value = s.gcashName;
    form.acceptOnlineOrders.checked = s.acceptOnlineOrders;
    form.defaultLowStockThreshold.value = s.defaultLowStockThreshold;
  } catch (error) {
    showToast(error.message, 'error');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(form);

  const saveButton = document.querySelector('#settings-save-btn');
  setBusy(saveButton, true, 'Saving…');

  try {
    const { message } = await api('/api/settings', {
      method: 'PATCH',
      body: {
        shopName: form.shopName.value,
        addressLine: form.addressLine.value,
        phone: form.phone.value,
        gcashNumber: form.gcashNumber.value,
        gcashName: form.gcashName.value,
        acceptOnlineOrders: form.acceptOnlineOrders.checked,
        defaultLowStockThreshold: parseInt(form.defaultLowStockThreshold.value, 10) || 0,
      },
    });
    showToast(message, 'success');
  } catch (error) {
    if (error.errors) showFieldErrors(form, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(saveButton, false);
  }
});

loadSettings();
