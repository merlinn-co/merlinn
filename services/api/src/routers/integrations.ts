import express, { Request, Response } from "express";
import { vendorModel, organizationModel, integrationModel } from "@merlinn/db";
import type { IIntegration } from "@merlinn/db";
import { checkJWT, getDBUser } from "../middlewares/auth";
import { catchAsync } from "../utils/errors";
import { AppError } from "../errors";
import { secretManager } from "../common/secrets";

const router = express.Router();

router.post(
  "/",
  checkJWT,
  getDBUser,
  catchAsync(async (req: Request, res: Response) => {
    const {
      vendor: vendorName,
      organization: organizationId,
      metadata,
      credentials,
    } = req.body;

    const vendor = await vendorModel.getOne({ name: vendorName });
    const organization = await organizationModel.getOneById(organizationId);
    if (!vendor) {
      throw new AppError(
        "Could not find a PagerDuty vendor. Make sure a vendor is defined.",
        404,
      );
    } else if (!organization) {
      throw new AppError("Could not find the given organization.", 404);
    }

    if (!req.user!.organization._id.equals(organizationId)) {
      throw new AppError("User is not a member of this organization", 403);
    }

    const formattedCredentials =
      credentials && Object.keys(credentials).length
        ? await secretManager.createCredentials(
            organizationId,
            vendorName,
            credentials,
          )
        : {};

    const integration = await integrationModel.create({
      vendor,
      organization,
      metadata,
      credentials: formattedCredentials as Record<string, string>,
    });

    return res.status(200).json({ integration });
  }),
);

router.put(
  "/:id",
  checkJWT,
  getDBUser,
  catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { tools } = req.body;

    const integration = await integrationModel.getOneById(id);
    if (!integration) {
      throw new AppError("No such integration", 404);
    }

    if (!req.user!.organization._id.equals(integration.organization._id)) {
      throw new AppError("User is not a member of this organization", 403);
    } else if (req.user!.role !== "owner") {
      throw new AppError("User is not allowed to perform this action", 403);
    }

    const { settings = {} } = integration;
    integration.settings = { ...settings.tools, ...tools };
    return res.status(200).json({ integration });
  }),
);

router.get(
  "/",
  checkJWT,
  getDBUser,
  catchAsync(async (req: Request, res: Response) => {
    const integrations = await integrationModel
      .get(req.query)
      .populate("vendor");

    const populated = await secretManager.populateCredentials(
      integrations as IIntegration[],
    );

    return res.status(200).json(populated);
  }),
);

router.get(
  "/slack",
  catchAsync(async (req: Request, res: Response) => {
    const actualServiceKey = req.headers["x-slackbot-service-key"];
    const expectedServiceKey = process.env.SLACKBOT_SERVICE_KEY as string;
    if (actualServiceKey !== expectedServiceKey) {
      throw new AppError("Unauthorized", 403);
    }

    const integrations = await integrationModel
      .get(req.query)
      .populate("vendor");

    const populated = await secretManager.populateCredentials(
      integrations as IIntegration[],
    );

    return res.status(200).json(populated);
  }),
);

router.delete(
  "/:id",
  getDBUser,
  catchAsync(async (req: Request, res: Response) => {
    if (req.user!.role !== "owner") {
      throw new AppError("Only owners can delete integrations", 403);
    }

    const integration = await integrationModel.getOne({
      organization: req.user!.organization._id,
      _id: req.params.id,
    });

    if (!integration) {
      throw new AppError("No such integration", 404);
    } else if (
      !req.user!.organization._id.equals(integration.organization._id)
    ) {
      throw new AppError("User is not a member of this organization", 403);
    }

    await secretManager.deleteCredentials([integration]);

    await integrationModel.deleteOneById(req.params.id);

    return res.status(200).send("Deleted successfully");
  }),
);

export { router };
