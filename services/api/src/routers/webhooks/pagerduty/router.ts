import express, { Request, Response } from "express";
import { SlackClient } from "../../../clients";
import { runAgent } from "../../../agent";
import {
  IIntegration,
  PagerDutyIntegration,
  PagerDutyWebhookEvent,
  SlackIntegration,
} from "../../../types";
import { integrationModel } from "../../../db/models/integration";
import { postInitialStatus } from "../utils";
import {
  checkAlertsQuota,
  checkWebhookSecret,
} from "../../../middlewares/webhooks";
import { checkPagerDutySignature } from "./utils";
import { parseAlertToPrompt } from "../../../services/alerts";
import { AnswerContext } from "../../../agent/callbacks";
import { EventType, SystemEvent, events } from "../../../events";
import { MessageMetadata } from "@slack/bolt";
import { investigationTemplate } from "../../../agent/prompts";
import { chatModel } from "../../../agent/model";
import { catchAsync } from "../../../utils/errors";
import { AppError, ErrorCode } from "../../../errors";
import { populateCredentials } from "../../../clients/secretManager";
import { RunContext } from "../../../agent/types";

const router = express.Router();

router.post(
  "/",
  checkPagerDutySignature,
  checkWebhookSecret,
  checkAlertsQuota,
  catchAsync(async (req: Request, res: Response) => {
    const { organization } = req.webhook!;
    const organizationName = organization.name;
    const organizationId = String(organization._id);

    const { event } = req.body as PagerDutyWebhookEvent;

    const integrations = (await integrationModel
      .get({
        organization: organization._id,
      })
      .populate("vendor")) as IIntegration[];

    // Get integrations to Slack and PagerDuty
    let slackIntegration = integrations.find(
      (integration) => integration.vendor.name === "Slack",
    ) as SlackIntegration;
    const pagerdutyIntegration = integrations.find(
      (integration) => integration.vendor.name === "PagerDuty",
    ) as PagerDutyIntegration;

    if (!slackIntegration) {
      throw new AppError("Slack integration was not found", 500);
    } else if (!pagerdutyIntegration) {
      throw new AppError("PagerDuty integration was not found", 500);
    }

    slackIntegration = (
      await populateCredentials([slackIntegration])
    )[0] as SlackIntegration;

    const { channel_id: channelId } = slackIntegration.metadata;
    const { access_token: slackToken } = slackIntegration.credentials;
    const slackClient = new SlackClient(slackToken);

    const prompt = await parseAlertToPrompt(
      event.data.id,
      "PagerDuty",
      String(organization._id),
    );

    const messages = await slackClient.getChannelHistoryGracefully(channelId);
    const pdMessage = messages?.find(
      (message) => message.text?.includes(event.data.id),
    );
    if (!pdMessage) {
      throw new AppError("Could not find Slack message", 500);
    }

    await postInitialStatus(slackToken, channelId, pdMessage.ts!);

    const callback = async (answer: string, context: AnswerContext) => {
      const traceId = context.getTraceId()!;
      const traceURL = context.getTraceURL()!;
      const observationId = context.getObservationId()!;
      const event: SystemEvent = {
        type: EventType.answer_created,
        payload: {
          env: process.env.NODE_ENV as string,
          context: "trigger-pagerduty",
          traceId,
          observationId,
          traceURL,
          organizationName,
          organizationId,
        },
      };

      // Post a reply to the thread
      const metadata: MessageMetadata = {
        event_type: event.type,
        event_payload: event.payload,
      };

      const response = await slackClient.postReply({
        channelId,
        ts: pdMessage?.ts as string,
        text: answer,
        metadata,
      });

      const { ok, ts } = response;
      if (ok) {
        await slackClient.addFeedbackReactions(channelId, ts!);
      }
      events.emit(event.type, event);
    };
    const context: RunContext = {
      organizationName,
      organizationId,
      env: process.env.NODE_ENV as string,
      eventId: event.data.id,
      context: "trigger-pagerduty",
    };
    try {
      await runAgent({
        prompt,
        template: investigationTemplate,
        model: chatModel,
        integrations,
        callback,
        context,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      throw new AppError(error.message, 500, ErrorCode.AGENT_RUN_FAILED);
    }

    return res.status(200).send("ok");
  }),
);

export { router };