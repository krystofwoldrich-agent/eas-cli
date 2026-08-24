import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { ObserveQuery } from '../../../graphql/queries/ObserveQuery';
import {
  buildObserveCustomEventDetail,
  buildObserveCustomEventJson,
} from '../../../observe/formatCustomEvents';
import { buildObserveEventDetail, buildObserveEventJson } from '../../../observe/formatEvents';
import { EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE } from '../../../observe/planGating';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveEvent from '../event';

jest.mock('../../../observe/formatEvents', () => ({
  buildObserveEventDetail: jest.fn().mockReturnValue('metric-detail'),
  buildObserveEventJson: jest.fn().mockReturnValue({ id: 'metric-json' }),
}));
jest.mock('../../../observe/formatCustomEvents', () => ({
  buildObserveCustomEventDetail: jest.fn().mockReturnValue('log-detail'),
  buildObserveCustomEventJson: jest.fn().mockReturnValue({ id: 'log-json' }),
}));
jest.mock('../../../graphql/queries/ObserveQuery', () => ({
  ObserveQuery: {
    customEventByIdAsync: jest.fn(),
    metricEventByIdAsync: jest.fn(),
  },
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockCustomEventByIdAsync = jest.mocked(ObserveQuery.customEventByIdAsync);
const mockMetricEventByIdAsync = jest.mocked(ObserveQuery.metricEventByIdAsync);
const mockBuildObserveEventDetail = jest.mocked(buildObserveEventDetail);
const mockBuildObserveEventJson = jest.mocked(buildObserveEventJson);
const mockBuildObserveCustomEventDetail = jest.mocked(buildObserveCustomEventDetail);
const mockBuildObserveCustomEventJson = jest.mocked(buildObserveCustomEventJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

// A custom (log) event ID is a UUID; a metric event ID is base64url-encoded JSON.
const UUID_ID = '123e4567-e89b-12d3-a456-426614174000';
const BASE64_ID = 'eyJhIjoxfQ';
const INVALID_ID = 'not a valid id';

describe(ObserveEvent, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockCustomEventByIdAsync.mockResolvedValue(null);
    mockMetricEventByIdAsync.mockResolvedValue(null);
  });

  function createCommand(argv: string[]): ObserveEvent {
    const command = new ObserveEvent(argv, mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  function planGateError(): CombinedError {
    const serverMessage =
      'Subscription to EAS is required for this feature. ' +
      'Subscribe: https://expo.dev/accounts/acme/settings/billing';
    return new CombinedError({
      graphQLErrors: [
        new GraphQLError(serverMessage, null, null, null, null, null, {
          errorCode: EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE,
        }),
      ],
    });
  }

  it('looks up a UUID id with the custom-event query only', async () => {
    mockCustomEventByIdAsync.mockResolvedValue({ id: UUID_ID } as any);
    await createCommand([UUID_ID]).runAsync();
    expect(mockCustomEventByIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: projectId,
      id: UUID_ID,
    });
    expect(mockMetricEventByIdAsync).not.toHaveBeenCalled();
    expect(mockBuildObserveCustomEventDetail).toHaveBeenCalledTimes(1);
  });

  it('looks up a base64 id with the metric-event query only', async () => {
    mockMetricEventByIdAsync.mockResolvedValue({ id: BASE64_ID } as any);
    await createCommand([BASE64_ID]).runAsync();
    expect(mockMetricEventByIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: projectId,
      id: BASE64_ID,
    });
    expect(mockCustomEventByIdAsync).not.toHaveBeenCalled();
    expect(mockBuildObserveEventDetail).toHaveBeenCalledTimes(1);
  });

  it('errors immediately for an ID that is neither a UUID nor base64, without querying', async () => {
    await expect(createCommand([INVALID_ID]).runAsync()).rejects.toThrow(
      /is not a valid Observe event ID/
    );
    expect(mockCustomEventByIdAsync).not.toHaveBeenCalled();
    expect(mockMetricEventByIdAsync).not.toHaveBeenCalled();
  });

  it('emits typed JSON for a metric event with --json', async () => {
    mockMetricEventByIdAsync.mockResolvedValue({ id: BASE64_ID } as any);
    await createCommand([BASE64_ID, '--json', '--non-interactive']).runAsync();
    expect(mockEnableJsonOutput).toHaveBeenCalledTimes(1);
    expect(mockBuildObserveEventJson).toHaveBeenCalledTimes(1);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      type: 'metric',
      event: { id: 'metric-json' },
    });
  });

  it('emits typed JSON for a log event with --json', async () => {
    mockCustomEventByIdAsync.mockResolvedValue({ id: UUID_ID } as any);
    await createCommand([UUID_ID, '--json', '--non-interactive']).runAsync();
    expect(mockBuildObserveCustomEventJson).toHaveBeenCalledTimes(1);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      type: 'log',
      event: { id: 'log-json' },
    });
  });

  it('throws not-found when a well-formed ID resolves to nothing', async () => {
    mockCustomEventByIdAsync.mockResolvedValue(null);
    await expect(createCommand([UUID_ID]).runAsync()).rejects.toThrow(
      new RegExp(`No Observe event found with ID "${UUID_ID}"`)
    );
  });

  it('surfaces the plan-gate message when the lookup is not available on the plan', async () => {
    mockCustomEventByIdAsync.mockRejectedValueOnce(planGateError());
    await expect(createCommand([UUID_ID]).runAsync()).rejects.toThrow(
      /Subscription to EAS is required/
    );
  });

  it('wraps an unexpected server error with an ID-specific message and preserves the request ID', async () => {
    const serverError = new CombinedError({
      graphQLErrors: [
        new GraphQLError('unexpected server error', null, null, null, null, null, {
          requestId: 'req-123',
        }),
      ],
    });
    mockCustomEventByIdAsync.mockRejectedValue(serverError);

    await expect(createCommand([UUID_ID]).runAsync()).rejects.toThrow(
      new RegExp(
        `Could not retrieve Observe event with ID "${UUID_ID}"[\\s\\S]*unexpected server error \\(Request ID: req-123\\)`
      )
    );
  });
});
