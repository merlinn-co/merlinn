import type {
  CoralogixIntegration,
  DataDogIntegration,
  GithubIntegration,
  IIntegration,
  JaegerIntegration,
  PrometheusIntegration,
  MongoDBIntegration,
} from "@merlinn/db";
import { toolLoaders as coralogixToolLoaders } from "./coralogix";
import { toolLoaders as githubToolLoaders } from "./github";
import { toolLoaders as datadogToolLoaders } from "./datadog";
import { toolLoaders as staticToolLoaders } from "./static";
import { toolLoaders as mongodbToolLoaders } from "./mongodb";
import { toolLoaders as jaegerToolLoaders } from "./jaeger";
import { toolLoaders as prometheusToolLoaders } from "./prometheus";
import { Tool } from "./types";
import { RunContext } from "../types";

type ToolLoader<T extends IIntegration> = (
  integration: T,
  context: RunContext,
) => Promise<Tool>;

export const compileTools = async <T extends IIntegration>(
  toolLoaders: ToolLoader<T>[],
  integration: T,
  context: RunContext,
): Promise<Tool[]> => {
  const tools = await Promise.all(
    toolLoaders.map((loader) => loader(integration, context)),
  );
  return tools;
};

export const createToolsForVendor = async <T extends IIntegration>(
  integrations: IIntegration[],
  vendor: string,
  toolLoaders: ToolLoader<T>[],
  context: RunContext,
) => {
  const tools = [] as Tool[];

  const integration = integrations.find(
    (integration) => integration.vendor.name === vendor,
  );
  if (integration) {
    const vendorTools = await compileTools<T>(
      toolLoaders,
      integration as T,
      context,
    );
    tools.push(...vendorTools);
  }

  return tools;
};

export const createTools = async (
  integrations: IIntegration[],
  context: RunContext,
) => {
  const tools = [] as Tool[];

  // Coralogix
  const [
    coralogixTools,
    githubTools,
    datadogTools,
    mongodbTools,
    jaegerTools,
    prometheusTools,
  ] = await Promise.all([
    createToolsForVendor<CoralogixIntegration>(
      integrations,
      "Coralogix",
      coralogixToolLoaders,
      context,
    ),
    createToolsForVendor<GithubIntegration>(
      integrations,
      "Github",
      githubToolLoaders,
      context,
    ),
    createToolsForVendor<DataDogIntegration>(
      integrations,
      "DataDog",
      datadogToolLoaders,
      context,
    ),
    createToolsForVendor<MongoDBIntegration>(
      integrations,
      "MongoDB",
      mongodbToolLoaders,
      context,
    ),
    createToolsForVendor<JaegerIntegration>(
      integrations,
      "Jaeger",
      jaegerToolLoaders,
      context,
    ),
    createToolsForVendor<PrometheusIntegration>(
      integrations,
      "Prometheus",
      prometheusToolLoaders,
      context,
    ),
  ]);

  // Static tools
  const staticTools = await Promise.all(
    staticToolLoaders.map((loader) => loader(context)),
  );

  // Add all the tools
  tools.push(
    ...coralogixTools,
    ...githubTools,
    ...datadogTools,
    ...mongodbTools,
    ...jaegerTools,
    ...prometheusTools,
    ...staticTools,
  );

  return tools;
};
