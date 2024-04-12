import express, { Request, Response } from "express";
import axios from "axios";
import { checkJWT, getDBUser } from "../middlewares/auth";
import { catchAsync } from "../utils/errors";
import { AppError, ErrorCode } from "../errors";
import { indexModel } from "../db/models/db-index";
import { pinecone } from "../clients/pinecone";
import { refreshAtlassianToken } from "../services/oauth";
import { integrationModel } from "../db/models/integration";
import { AtlassianIntegration, IIntegration } from "../types";
import { zip } from "../utils/arrays";
import { getTimestamp } from "../utils/dates";
import { getPlanFieldState } from "../services/plans";
import { PlanFieldCode } from "../types";

const ATLASSIAN_DATA_SOURCES = ["Confluence", "Jira"];

const router = express.Router();
router.use(checkJWT);
router.use(getDBUser);
// TODO: remove once we finish with beta testing ang do public!

router.get(
  "/",
  catchAsync(async (req: Request, res: Response) => {
    if (req.user!.role !== "owner") {
      throw new AppError("Only owners can access indexes", 403);
    }

    const index = await indexModel.getOne({
      name: String(req.user!.organization._id),
    });

    return res.status(200).json(index);
  }),
);

router.post(
  "/",
  catchAsync(async (req: Request, res: Response) => {
    if (req.user!.role !== "owner") {
      throw new AppError("Only owners are allowed to create indexes", 403);
    }

    const attemptsState = await getPlanFieldState({
      fieldCode: PlanFieldCode.indexingAttempts,
      organizationId: String(req.user!.organization._id),
    });
    if (!attemptsState.isAllowed) {
      throw new AppError(
        `You have exceeded your indexing attempts' quota`,
        429,
        ErrorCode.QUOTA_EXCEEDED,
      );
    }

    // TODO: use a proper messaging solution instead of plain API request
    const { dataSources } = req.body;
    if (!dataSources) {
      throw new AppError("No data sources provided", 400);
    }

    const integrations = await Promise.all(
      dataSources.map(async (source: string) => {
        const integration = await integrationModel.getIntegrationByName(
          source,
          {
            organization: req.user!.organization._id,
          },
        );
        if (!integration) {
          throw new AppError(`No such integration "${source}"`, 404);
        }
        return integration;
      }),
    );

    // TODO: right now we hard-code the refresh token mechanism in several places in the code,
    // and we make it specific to PagerDuty and Atlassian. We should make it more generic.
    await Promise.all(
      zip(dataSources, integrations)
        .filter(([source]) => ATLASSIAN_DATA_SOURCES.includes(source as string))
        .map(async ([, integration]) => {
          const { expires_in } = (integration as AtlassianIntegration).metadata;
          const issueDate = (integration as AtlassianIntegration).updatedAt;
          const expirationDate = new Date(
            getTimestamp({
              offset: issueDate,
              amount: -Number(expires_in),
              scale: "seconds",
            }),
          );
          if (expirationDate < issueDate) {
            await refreshAtlassianToken(
              (integration as IIntegration)._id.toString(),
            );
          }
        }),
    );

    // TODO: use a proper messaging solution instead of plain API request
    const serviceUrl = process.env.DATA_PROCESSOR_URL as string;
    const { data: index } = await axios.post(`${serviceUrl}/build-index`, {
      organizationId: String(req.user!.organization._id),
      dataSources: dataSources,
    });

    return res.status(202).json({ index });
  }),
);

router.delete(
  "/:id",
  catchAsync(async (req: Request, res: Response) => {
    if (req.user!.role !== "owner") {
      throw new AppError("Only owners can delete indexes", 403);
    }

    const { id } = req.params;
    const index = await indexModel.getOneById(id);
    if (!index) {
      throw new AppError("No such embeddings db", 404);
    } else if (!req.user!.organization._id.equals(index.organization._id)) {
      throw new AppError("User is not a member of this organization", 403);
    }

    // Delete pinecone index
    await pinecone.deleteIndex(index.name);

    // Delete internal index
    await indexModel.deleteOneById(id);

    return res.status(200).json({ message: "Successfully deleted index" });
  }),
);

export { router };