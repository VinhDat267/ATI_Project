import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openGooglePicker, type GooglePickerSession } from '../src/services/google-picker';

describe('openGooglePicker', () => {
  const session: GooglePickerSession = {
    accessToken: 'test-token-123',
    developerKey: 'dev-key-456',
    appId: '1234567890',
  };

  beforeEach(() => {
    // Clean up DOM and window
    document.querySelectorAll('script[src*="apis.google.com"]').forEach((s) => s.remove());
    delete (window as any).gapi;
    delete (window as any).google;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads google api script, initializes picker with required builder options, and resolves spreadsheet IDs on PICKED', async () => {
    let pickerCallback: (data: any) => void = () => {};
    const mockBuilder = {
      addView: vi.fn().mockReturnThis(),
      enableFeature: vi.fn().mockReturnThis(),
      setOAuthToken: vi.fn().mockReturnThis(),
      setDeveloperKey: vi.fn().mockReturnThis(),
      setAppId: vi.fn().mockReturnThis(),
      setLocale: vi.fn().mockReturnThis(),
      setMaxItems: vi.fn().mockReturnThis(),
      setCallback: vi.fn().mockImplementation((cb) => {
        pickerCallback = cb;
        return mockBuilder;
      }),
      build: vi.fn().mockReturnValue({
        setVisible: vi.fn().mockImplementation(() => {
          // Simulate user picking 2 spreadsheets
          pickerCallback({
            action: 'picked',
            docs: [
              { id: 'sheet-id-1', name: 'Bảng tính 1' },
              { id: 'sheet-id-2', name: 'Bảng tính 2' },
            ],
          });
        }),
      }),
    };

    function MockPickerBuilder(this: any) {
      return mockBuilder;
    }

    (window as any).gapi = {
      load: vi.fn().mockImplementation((_name: string, cbOrOptions: any) => {
        if (typeof cbOrOptions === 'function') cbOrOptions();
        else if (cbOrOptions?.callback) cbOrOptions.callback();
      }),
    };
    (window as any).google = {
      picker: {
        ViewId: { SPREADSHEETS: 'spreadsheets' },
        Feature: { MULTISELECT_ENABLED: 'multiselect-enabled' },
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
        Response: { ACTION: 'action', DOCUMENTS: 'docs' },
        Document: { ID: 'id' },
        PickerBuilder: vi.fn().mockImplementation(MockPickerBuilder),
      },
    };

    const promise = openGooglePicker(session, 10);
    const result = await promise;

    expect(result).toEqual(['sheet-id-1', 'sheet-id-2']);
    expect(mockBuilder.addView).toHaveBeenCalledWith('spreadsheets');
    expect(mockBuilder.enableFeature).toHaveBeenCalledWith('multiselect-enabled');
    expect(mockBuilder.setOAuthToken).toHaveBeenCalledWith('test-token-123');
    expect(mockBuilder.setDeveloperKey).toHaveBeenCalledWith('dev-key-456');
    expect(mockBuilder.setAppId).toHaveBeenCalledWith('1234567890');
    expect(mockBuilder.setLocale).toHaveBeenCalledWith('vi');
    expect(mockBuilder.setMaxItems).toHaveBeenCalledWith(10);
  });

  it('resolves null when user cancels picker', async () => {
    let pickerCallback: (data: any) => void = () => {};
    const mockBuilder = {
      addView: vi.fn().mockReturnThis(),
      enableFeature: vi.fn().mockReturnThis(),
      setOAuthToken: vi.fn().mockReturnThis(),
      setDeveloperKey: vi.fn().mockReturnThis(),
      setAppId: vi.fn().mockReturnThis(),
      setLocale: vi.fn().mockReturnThis(),
      setMaxItems: vi.fn().mockReturnThis(),
      setCallback: vi.fn().mockImplementation((cb) => {
        pickerCallback = cb;
        return mockBuilder;
      }),
      build: vi.fn().mockReturnValue({
        setVisible: vi.fn().mockImplementation(() => {
          pickerCallback({
            action: 'cancel',
          });
        }),
      }),
    };

    function MockPickerBuilder(this: any) {
      return mockBuilder;
    }

    (window as any).gapi = {
      load: vi.fn().mockImplementation((_name: string, cbOrOptions: any) => {
        if (typeof cbOrOptions === 'function') cbOrOptions();
        else if (cbOrOptions?.callback) cbOrOptions.callback();
      }),
    };
    (window as any).google = {
      picker: {
        ViewId: { SPREADSHEETS: 'spreadsheets' },
        Feature: { MULTISELECT_ENABLED: 'multiselect-enabled' },
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
        Response: { ACTION: 'action', DOCUMENTS: 'docs' },
        Document: { ID: 'id' },
        PickerBuilder: vi.fn().mockImplementation(MockPickerBuilder),
      },
    };

    const result = await openGooglePicker(session, 5);
    expect(result).toBeNull();
  });

  it('rejects with descriptive Vietnamese error when script loading fails', async () => {
    // Simulate script injection failing
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = origCreateElement(tagName);
      if (tagName.toLowerCase() === 'script') {
        setTimeout(() => {
          el.onerror?.(new Event('error') as any);
        }, 0);
      }
      return el;
    });

    await expect(openGooglePicker(session, 10)).rejects.toThrow(
      'Không mở được cửa sổ chọn file của Google. Kiểm tra kết nối mạng hoặc trình chặn quảng cáo, rồi thử lại.'
    );
  });

  it('reuses existing window.gapi and does not append a duplicate script tag', async () => {
    (window as any).gapi = {
      load: vi.fn((_name: string, cb: any) => (typeof cb === 'function' ? cb() : cb.callback())),
    };
    (window as any).google = {
      picker: {
        ViewId: { SPREADSHEETS: 'spreadsheets' },
        Feature: { MULTISELECT_ENABLED: 'multiselect-enabled' },
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
        Response: { ACTION: 'action', DOCUMENTS: 'docs' },
        Document: { ID: 'id' },
        PickerBuilder: vi.fn(function (this: any) {
          const self = this;
          return {
            addView: vi.fn().mockReturnThis(),
            enableFeature: vi.fn().mockReturnThis(),
            setOAuthToken: vi.fn().mockReturnThis(),
            setDeveloperKey: vi.fn().mockReturnThis(),
            setAppId: vi.fn().mockReturnThis(),
            setLocale: vi.fn().mockReturnThis(),
            setMaxItems: vi.fn().mockReturnThis(),
            setCallback: vi.fn().mockImplementation((cb) => {
              cb({ action: 'cancel' });
              return self;
            }),
            build: vi.fn().mockReturnValue({ setVisible: vi.fn() }),
          };
        }),
      },
    };

    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const result = await openGooglePicker(session, 5);
    expect(result).toBeNull();
    expect(appendChildSpy).not.toHaveBeenCalled();
  });
});
