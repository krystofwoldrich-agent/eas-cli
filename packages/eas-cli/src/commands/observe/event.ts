import { Args } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasCommandError } from '../../commandUtils/errors';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { GraphqlError } from '../../graphql/client';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import Log from '../../log';
import {
  buildObserveCustomEventDetail,
  buildObserveCustomEventJson,
} from '../../observe/formatCustomEvents';
import { buildObserveEventDetail, buildObserveEventJson } from '../../observe/formatEvents';
import { ObserveProjectIdFlag } from '../../observe/flags';
import { withObservePlanGateHandlingAsync } from '../../observe/planGating';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ObserveEvent extends EasCommand {
  static override description = 'display a single Observe event (metric or log) by its ID';

  static override args = {
    id: Args.string({
      description:
        'ID of the event to display (from `eas observe:events` or `eas observe:session`)',
      required: true,
    }),
  };

  static override flags = {
    ...ObserveProjectIdFlag,
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  private static loggedInOnlyContextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags, args } = await this.parse(ObserveEvent);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveEvent,
      loggedInOnlyContextDefinition: ObserveEvent.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive,
    });

    if (json) {
      enableJsonOutput();
    }

    // An event ID is either a metric-event ID or a custom (log) event ID, and
    // their formats don't overlap, so we look up both and use whichever the
    // server resolves. Both are null when nothing matches.
    let result: Awaited<ReturnType<typeof ObserveQuery.eventByIdAsync>>;
    try {
      result = await withObservePlanGateHandlingAsync(() =>
        ObserveQuery.eventByIdAsync(graphqlClient, { appId: projectId, id: args.id })
      );
    } catch (error) {
      // Plan-gate rejections are already translated into a friendly upgrade
      // message; surface those unchanged. Everything else — most commonly a
      // server error for an unknown or malformed ID, which reaches the user as
      // an opaque "unexpected server error" — becomes an actionable message
      // that still preserves the underlying server error for support.
      if (error instanceof EasCommandError) {
        throw error;
      }
      throw new EasCommandError(
        `Could not retrieve Observe event with ID "${args.id}". ` +
          'The ID may be invalid or the event may not exist (events also age out of retention). ' +
          'Verify it was copied in full from `eas observe:events` or `eas observe:session`.' +
          `\n\n${describeObserveServerError(error)}`
      );
    }

    const { event, customEvent } = result;

    if (customEvent) {
      if (json) {
        printJsonOnlyOutput({ type: 'log', event: buildObserveCustomEventJson(customEvent) });
      } else {
        Log.addNewLineIfNone();
        Log.log(buildObserveCustomEventDetail(customEvent));
      }
      return;
    }

    if (event) {
      if (json) {
        printJsonOnlyOutput({ type: 'metric', event: buildObserveEventJson(event) });
      } else {
        Log.addNewLineIfNone();
        Log.log(buildObserveEventDetail(event));
      }
      return;
    }

    throw new EasCommandError(
      `No Observe event found with ID "${args.id}". IDs come from \`eas observe:events\` or \`eas observe:session\`, and events age out of retention.`
    );
  }
}

/**
 * Extract a human-readable description from a GraphQL/server error, including
 * the request ID(s) so a support request can reference them. Falls back to the
 * error's own message for non-GraphQL errors.
 */
function describeObserveServerError(error: unknown): string {
  if (error instanceof GraphqlError && error.graphQLErrors.length > 0) {
    return error.graphQLErrors
      .map(graphQLError => {
        const message = graphQLError.message.replace('[GraphQL] ', '');
        const requestId = graphQLError.extensions?.requestId;
        return requestId ? `${message} (Request ID: ${String(requestId)})` : message;
      })
      .join('\n');
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
