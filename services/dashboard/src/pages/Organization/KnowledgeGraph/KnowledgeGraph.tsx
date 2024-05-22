import {
  Box,
  Button,
  Card,
  CircularProgress,
  Divider,
  LinearProgress,
  List,
  ListDivider,
  ListItem,
  ListItemContent,
  ListItemDecorator,
  Typography,
} from "@mui/joy";
import { OrgTabs } from "../Tabs";
import { useIntegrations } from "../../../api/queries/integrations";
import { ConnectionName } from "../../../types/Connections";
import { useVendors } from "../../../api/queries/vendors";
import { CustomSwitch } from "./components/Switch";
import React, { useEffect, useState } from "react";
import { styled } from "styled-components";
import { icons } from "../../../components/Connection/icons";
import { Link } from "react-router-dom";
import { PieChart } from "@mui/x-charts/PieChart";
import {
  useCreateIndex,
  useDeleteIndex,
  useIndex,
} from "../../../api/queries/knowledgeGraph";
import toast from "react-hot-toast";
import { DangerZone } from "../../../components/DangerZone";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "../../../utils/date";
import { Usage } from "../../../components/Usages";
import { useMe } from "../../../api/queries/auth";
import InfoIcon from "@mui/icons-material/Info";
import { AlertDialog } from "../../../components/Dialogs";

const Null = styled.span``;
const emptySeries = [
  {
    name: "No Integrations",
    value: 100,
    label: "No Integrations",
    color: "gray",
  },
];

const INDEXABLE_VENDORS = [
  "Slack",
  "Github",
  "Notion",
  "Confluence",
  "Jira",
  "PagerDuty",
];

export const OrganizationKnowledgeGraphPage = () => {
  const integrationsQuery = useIntegrations();
  const vendorsQuery = useVendors();
  const queryClient = useQueryClient();

  const { mutateAsync: indexCreation, isPending } = useCreateIndex();
  const { data: user } = useMe();
  const organization = user?.organization;

  const index = useIndex();

  const [statusText, setStatusText] = useState<string>("");
  const [progress, setProgress] = useState<number>(5);

  useEffect(() => {
    const { data } = index;

    if (data?.state?.status === "pending") {
      if (data.state.integrations) {
        let entry = Object.keys(data.state.integrations).find((key) => {
          const value = data.state.integrations[key];
          return value === "in_progress";
        });

        const totalAmount = Object.keys(data.state.integrations).length;
        const percentPerVendor = 90 / totalAmount;

        const completedList = Object.keys(data.state.integrations).filter(
          (key) => {
            const value = data.state.integrations[key];
            return value === "completed";
          },
        );

        setProgress(Math.max(5, completedList.length * percentPerVendor));

        if (entry) {
          setStatusText(`Fetching documents from ${entry}...`);
        } else {
          entry = Object.keys(data.state.integrations).find((key) => {
            const value = data.state.integrations[key];
            return value === "in_queue";
          });
          if (entry) {
            setStatusText("Initializing process.");
          } else {
            setStatusText("Embedding documents...");
          }
        }
      }
    } else if (data?.state?.status === "completed") {
      setProgress(100);
    } else if (data?.state?.status === "failed") {
      setProgress(5);
    }
  }, [index]);

  const connectedVendors = integrationsQuery.data?.map(
    (integration: { vendor: { name: ConnectionName } }) =>
      integration.vendor.name,
  );

  const [selectedVendors, setSelectedVendors] = useState<string[]>(
    index.data?.dataSources || [],
  );
  useEffect(() => {
    setSelectedVendors(index.data?.dataSources || []);
  }, [index.data]);
  const [isConfirmOpen, setConfirmOpen] = useState<boolean>(false);

  const seriesData = index?.data?.stats
    ? Object.entries(index.data.stats)
        .map(([key, value]) => {
          return {
            name: key,
            value: value || 0,
            label: `${key}: ${value}`,
          } as { name: string; value: number; label: string };
        })
        .filter((item: { value: number }) => item.value > 0) || emptySeries
    : emptySeries;

  const handleBuildIndex = () => {
    const promise = indexCreation({
      dataSources: selectedVendors,
    });

    toast.promise(promise, {
      loading: "Initializing...",
      success: "Started creating index!",
      error: "Could not create index",
    });
  };

  const { mutateAsync: deleteIndex } = useDeleteIndex();

  const handleDelete = async () => {
    const promise = deleteIndex(index.data!._id);

    toast.promise(promise, {
      loading: "Deleting knowledge graph...",
      success: "Graph has been deleted!",
      error: "Could not delete knowledge graph",
    });

    await promise;
    queryClient.invalidateQueries({ queryKey: ["index"] });
  };

  const submitLabel = index.data ? "Rebuild Index" : "Build Index";
  const confirmMessage = index.data
    ? "Are you sure you want to rebuild the index? All of its data will be deleted"
    : `You will be creating a new index with the selected data sources: ${selectedVendors.join(
        ", ",
      )}. Do you want to continue?`;
  return (
    <Box paddingBottom={"40px"}>
      <OrgTabs />
      <Box width={"80%"} margin="auto" mt="20px">
        <Card sx={{ display: "flex" }}>
          <Typography level="title-lg">Knowledge Graph</Typography>
          <Typography level="body-sm" mt={"10px"}>
            Creating a knowledge graph is a crucial step in integrating Merlinn.
            By creating it, you're enabling our system to access contextual data
            in real time.
          </Typography>
          <Box display={"flex"} mt="40px">
            <Box width="40%">
              <Typography level="title-md">Sources</Typography>

              <List
                sx={{
                  height: "400px",
                  overflow: "auto",
                  marginTop: "20px",
                }}
              >
                {vendorsQuery.data
                  ?.filter((vendor) => INDEXABLE_VENDORS.includes(vendor.name))
                  .map(
                    (vendor: { name: ConnectionName; description: string }) => {
                      const Icon =
                        icons?.[vendor.name as keyof typeof icons] || Null;
                      const isConnected = connectedVendors?.includes(
                        vendor.name,
                      );
                      return (
                        <React.Fragment key={vendor.name + "knowledge"}>
                          <ListItem>
                            <ListItemDecorator>
                              <Icon
                                style={{
                                  marginRight: "10px",
                                  width: "30px",
                                  height: "30px",
                                }}
                              />
                            </ListItemDecorator>
                            <ListItemContent> {vendor.name}</ListItemContent>
                            {isConnected ? (
                              <CustomSwitch
                                checked={selectedVendors?.includes(vendor.name)}
                                disabled={
                                  index.data?.state?.status === "pending" ||
                                  isPending
                                }
                                onChange={(e: {
                                  target: { checked: boolean };
                                }) => {
                                  if (e.target.checked) {
                                    setSelectedVendors((selectedVendors) => [
                                      ...selectedVendors,
                                      vendor.name,
                                    ]);
                                  } else {
                                    setSelectedVendors((selectedVendors) =>
                                      selectedVendors?.filter(
                                        (item) => item !== vendor.name,
                                      ),
                                    );
                                  }
                                }}
                              />
                            ) : (
                              <Link to="/organization/integrations">
                                Connect
                              </Link>
                            )}
                          </ListItem>
                          <ListDivider />
                        </React.Fragment>
                      );
                    },
                  )}
              </List>
            </Box>
            <Divider orientation="vertical" sx={{ margin: "0 20px" }} />

            <Box width="60%">
              <Typography level="title-md">Distribution</Typography>
              {seriesData.length === 0 ? (
                <Typography level="body-sm" sx={{ marginTop: "20px" }}>
                  No documents indexed yet
                </Typography>
              ) : (
                <PieChart
                  tooltip={{
                    trigger: "item",
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    itemContent: (data: any) => {
                      const item = data.series.data.find(
                        (item: { index: number }) =>
                          item.index === data.itemData.dataIndex,
                      );
                      const { formattedValue, name } = item;

                      return (
                        <Card style={{ marginLeft: "20px", display: "inline" }}>
                          {name}:{" "}
                          <span style={{ fontWeight: "bold" }}>
                            {formattedValue.toLocaleString()}
                          </span>{" "}
                          Documents
                        </Card>
                      );
                    },
                  }}
                  series={[
                    {
                      data: seriesData,
                      innerRadius: 30,
                      outerRadius: 100,
                      paddingAngle: 5,
                      cornerRadius: 5,
                      startAngle: -180,
                      endAngle: 180,
                      cx: 150,
                      cy: 150,
                    },
                  ]}
                  height={400}
                />
              )}
              <Box>
                {index.data?.updatedAt && (
                  <div style={{ margin: "10px 0" }}>
                    <Typography level="title-sm">Last Indexed at: </Typography>
                    <Typography level="body-sm">
                      {formatDate(index.data?.updatedAt)}
                    </Typography>
                  </div>
                )}
                <Usage
                  title={"Indexing Attempts"}
                  variable={"indexingAttempts"}
                  template={
                    "Your team has used %s out of %s indexing attempts per month."
                  }
                  organizationId={organization}
                />
              </Box>
            </Box>
          </Box>

          <Box display={"flex"} alignItems={"center"} mt="20px">
            <Button
              variant="solid"
              color="primary"
              onClick={() => setConfirmOpen(true)}
              disabled={
                selectedVendors.length === 0 ||
                index.data?.state?.status === "pending" ||
                isPending
              }
            >
              {submitLabel}
            </Button>
            {index.data?.state?.status === "pending" || isPending ? (
              <>
                <CircularProgress sx={{ marginLeft: "20px" }} size="sm" />
                <Typography sx={{ marginLeft: "20px" }}>
                  {statusText}
                </Typography>
              </>
            ) : index.data?.state?.status === "failed" ? (
              <Typography sx={{ color: "red", marginLeft: "20px" }}>
                Index creation failed, please try again or contact support.
              </Typography>
            ) : null}
            {index?.data?.state?.status === "pending" && (
              <span style={{ width: "300px", margin: "0 auto" }}>
                <LinearProgress
                  variant="outlined"
                  determinate
                  value={progress}
                  sx={{}}
                />
              </span>
            )}
          </Box>
        </Card>

        <AlertDialog
          color="primary"
          label="Approve"
          icon={<InfoIcon />}
          open={isConfirmOpen}
          onSubmit={handleBuildIndex}
          onClose={() => setConfirmOpen(false)}
          message={confirmMessage}
        />
        {index.data &&
          !isPending &&
          index.data?.state?.status !== "pending" && (
            <DangerZone
              title="Delete Knowledge Graph"
              description="Once deleted, it will be gone forever. Please be certain."
              dialogContent={`Are you sure you want to delete your organizations knowledge graph?`}
              onDelete={handleDelete}
              deleteButtonText="Delete Graph"
              sx={{ marginTop: "30px" }}
            />
          )}
      </Box>
    </Box>
  );
};
