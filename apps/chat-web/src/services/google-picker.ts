export interface GooglePickerSession {
  accessToken: string;
  developerKey: string;
  appId: string;
}

const GOOGLE_API_SRC = 'https://apis.google.com/js/api.js';
const SCRIPT_ERROR_MSG =
  'Không mở được cửa sổ chọn file của Google. Kiểm tra kết nối mạng hoặc trình chặn quảng cáo, rồi thử lại.';

let gapiLoadPromise: Promise<void> | null = null;

function loadGoogleApiScript(): Promise<void> {
  if (typeof (window as any).gapi !== 'undefined' && typeof (window as any).gapi.load === 'function') {
    return Promise.resolve();
  }
  if (gapiLoadPromise) return gapiLoadPromise;

  gapiLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GOOGLE_API_SRC}"]`);
    if (existing) {
      if ((window as any).gapi) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => {
        gapiLoadPromise = null;
        reject(new Error(SCRIPT_ERROR_MSG));
      });
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_API_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gapiLoadPromise = null;
      script.remove();
      reject(new Error(SCRIPT_ERROR_MSG));
    };
    document.body.appendChild(script);
  });

  return gapiLoadPromise;
}

function loadPickerApi(): Promise<void> {
  return new Promise((resolve, reject) => {
    const gapi = (window as any).gapi;
    if (!gapi || typeof gapi.load !== 'function') {
      return reject(new Error(SCRIPT_ERROR_MSG));
    }
    gapi.load('picker', {
      callback: () => resolve(),
      onerror: () => reject(new Error(SCRIPT_ERROR_MSG)),
    });
  });
}

export async function openGooglePicker(
  session: GooglePickerSession,
  maxItems: number
): Promise<string[] | null> {
  await loadGoogleApiScript();
  await loadPickerApi();

  const google = (window as any).google;
  if (!google || !google.picker || !google.picker.PickerBuilder) {
    throw new Error(SCRIPT_ERROR_MSG);
  }

  return new Promise((resolve, reject) => {
    try {
      const picker = new google.picker.PickerBuilder()
        .addView(google.picker.ViewId.SPREADSHEETS)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(session.accessToken)
        .setDeveloperKey(session.developerKey)
        .setAppId(session.appId)
        .setLocale('vi')
        .setMaxItems(maxItems)
        .setCallback((data: any) => {
          try {
            const action = data[google.picker.Response.ACTION];
            if (action === google.picker.Action.PICKED) {
              const docs = data[google.picker.Response.DOCUMENTS] || [];
              const ids: string[] = docs
                .map((d: any) => d[google.picker.Document.ID] || d.id)
                .filter(Boolean);
              resolve(ids);
            } else if (action === google.picker.Action.CANCEL) {
              resolve(null);
            }
          } catch (err) {
            reject(err);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (err) {
      reject(new Error(SCRIPT_ERROR_MSG));
    }
  });
}
