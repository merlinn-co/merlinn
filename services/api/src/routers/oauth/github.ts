import express, { Request, Response } from "express";
import { catchAsync } from "../../utils/errors";
import { AppError } from "../../errors";
import axios, { AxiosError } from "axios";
import { vendorModel } from "../../db/models/vendor";
import { organizationModel } from "../../db/models/organization";
import { createCredentials } from "../../clients/secretManager";
import { integrationModel } from "../../db/models/integration";

const router = express.Router();

router.get(
  "/callback",
  catchAsync(async (req: Request, res: Response) => {
    const { code, state } = req.query;
    if (!code) {
      throw new AppError("No code was provided", 400);
    } else if (!state) {
      throw new AppError("No state was provided", 400);
    }

    try {
      const params = new URLSearchParams();
      params.append("client_id", process.env.GH_APP_CLIENT_ID as string);
      params.append(
        "client_secret",
        process.env.GH_APP_CLIENT_SECRET as string,
      );
      params.append("code", code as string);

      const response = await axios.post(
        "https://github.com/login/oauth/access_token",
        params,
      );

      const credentials = response.data
        .split("&")
        .reduce((total: Record<string, string>, current: string) => {
          const [key, val] = current.split("=");
          total[key] = val;
          return total;
        }, {});

      const vendor = await vendorModel.getOne({ name: "Github" });
      const organization = await organizationModel.getOneById(state as string);
      if (!vendor) {
        throw new AppError(
          "Could not find a Github vendor. Make sure a vendor is defined.",
          404,
        );
      } else if (!organization) {
        throw new AppError("Could not find the given organization.", 404);
      }

      const { access_token, ...metadata } = credentials;

      const formattedCredentials = await createCredentials(
        organization._id.toString(),
        vendor.name,
        { access_token },
      );

      // Create the integration
      await integrationModel.create({
        vendor,
        organization,
        credentials: formattedCredentials,
        metadata,
      });

      return res.send("App installed successfully");
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof AxiosError) {
        if (error.response) {
          throw new AppError(JSON.stringify(error.response.data), 500);
        }
        throw new AppError(error.message, 500);
      }
      throw error;
    }
  }),
);

export { router };