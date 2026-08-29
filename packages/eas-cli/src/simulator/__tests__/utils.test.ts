import { DeviceRunSessionResourceClass, DeviceRunSessionType } from '../../graphql/generated';
import {
  DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_FLAG_VALUES,
  deviceRunSessionTypeToFlagValue,
  formatPreviewUrl,
  formatRemoteSessionInstructions,
  getRemoteSessionEnvironmentVariables,
} from '../utils';

const iosAppiumConfig = {
  __typename: 'AppiumRunSessionRemoteConfig' as const,
  appiumUrl: 'https://appium.example.test',
  capabilities: {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': 'simulator-id',
  },
  webPreviewUrl: 'https://preview.example.test',
};

describe('Appium simulator configuration', () => {
  it('maps the appium CLI value to the GraphQL enum', () => {
    expect(DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE.appium).toBe(DeviceRunSessionType.Appium);
  });

  it('creates the Appium client environment', () => {
    expect(getRemoteSessionEnvironmentVariables(iosAppiumConfig)).toEqual({
      APPIUM_URL: 'https://appium.example.test',
      APPIUM_CAPS:
        '{"platformName":"iOS","appium:automationName":"XCUITest","appium:udid":"simulator-id"}',
    });
  });

  it('does not print the URL in managed dotenv instructions', () => {
    const instructions = formatRemoteSessionInstructions(iosAppiumConfig, 'dotenv');

    expect(instructions).toContain('eas simulator:exec <appium-client> [args...]');
    expect(instructions).toContain('https://preview.example.test');
    expect(instructions).toContain('Open the simulator preview:');
    expect(instructions).not.toContain('iOS simulator preview');
    expect(instructions).not.toContain('https://appium.example.test');
  });
});

describe('simulator session type flags', () => {
  it('maps web-preview-only to the WebPreviewOnly GraphQL enum', () => {
    expect(DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE['web-preview-only']).toBe(
      DeviceRunSessionType.WebPreviewOnly
    );
    expect(DEVICE_RUN_SESSION_TYPE_FLAG_VALUES[DeviceRunSessionType.ServeSim]).toBe(
      'web-preview-only'
    );
    expect(DEVICE_RUN_SESSION_TYPE_FLAG_VALUES[DeviceRunSessionType.WebPreviewOnly]).toBe(
      'web-preview-only'
    );
    expect(deviceRunSessionTypeToFlagValue(DeviceRunSessionType.ServeSim)).toBe('web-preview-only');
    expect(deviceRunSessionTypeToFlagValue(DeviceRunSessionType.WebPreviewOnly)).toBe(
      'web-preview-only'
    );
    expect(DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE['serve-sim']).toBeUndefined();
    expect(DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE['web-preview']).toBeUndefined();
  });
});

describe('simulator resource class flags', () => {
  it('maps CLI values to the GraphQL enum', () => {
    expect(DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE.large).toBe(
      DeviceRunSessionResourceClass.Large
    );
    expect(DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE.medium).toBe(
      DeviceRunSessionResourceClass.Medium
    );
  });
});

describe(formatPreviewUrl, () => {
  it('appends the session token for a gated preview', () => {
    expect(formatPreviewUrl('https://preview.example.test', 'tok-1')).toBe(
      'https://preview.example.test/?token=tok-1'
    );
  });

  it('leaves the url alone when the preview is ungated', () => {
    expect(formatPreviewUrl('https://preview.example.test', null)).toBe(
      'https://preview.example.test'
    );
    expect(formatPreviewUrl('https://preview.example.test', undefined)).toBe(
      'https://preview.example.test'
    );
  });
});

describe('gated preview links', () => {
  const PREVIEW = 'https://preview.example.test';
  const GATED = `${PREVIEW}/?token=tok-1`;

  it('prints the tokenized preview for a serve-sim session', () => {
    const instructions = formatRemoteSessionInstructions(
      {
        __typename: 'ServeSimRunSessionRemoteConfig' as const,
        previewUrl: PREVIEW,
        previewToken: 'tok-1',
      },
      'env'
    );

    expect(instructions).toContain(GATED);
  });

  it('prints the tokenized preview for every controller session type', () => {
    const controllers = [
      {
        __typename: 'AgentDeviceRunSessionRemoteConfig' as const,
        agentDeviceRemoteSessionUrl: 'https://daemon.example.test',
        agentDeviceRemoteSessionToken: 'daemon-token',
        webPreviewUrl: PREVIEW,
        webPreviewToken: 'tok-1',
      },
      {
        __typename: 'ArgentRunSessionRemoteConfig' as const,
        toolsUrl: 'https://argent.example.test',
        toolsAuthToken: 'argent-token',
        webPreviewUrl: PREVIEW,
        webPreviewToken: 'tok-1',
      },
      { ...iosAppiumConfig, webPreviewToken: 'tok-1' },
    ];

    for (const remoteConfig of controllers) {
      expect(formatRemoteSessionInstructions(remoteConfig, 'env')).toContain(GATED);
    }
  });

  it('prints the plain url when the preview is ungated', () => {
    const instructions = formatRemoteSessionInstructions(
      { __typename: 'ServeSimRunSessionRemoteConfig' as const, previewUrl: PREVIEW },
      'env'
    );

    expect(instructions).toContain(PREVIEW);
    expect(instructions).not.toContain('token=');
  });
});
