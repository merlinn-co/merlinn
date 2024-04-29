from typing import Dict, List, Literal, Optional, Union
from pydantic import Field, BaseModel
from models.common import CommonDBModel, PyObjectId


class Vendor(CommonDBModel):
    name: str
    description: str


class Organization(CommonDBModel):
    name: str


class Integration(CommonDBModel):
    vendor: Union[PyObjectId, Vendor]
    organization: Union[PyObjectId, Organization]
    credentials: Optional[dict] = None
    metadata: dict


class User(CommonDBModel):
    auth0Id: str
    email: str
    status: Literal["activated", "invited"]
    role: Literal["owner", "member"]
    organization: Union[PyObjectId, Organization]


class IndexState(BaseModel):
    status: Literal["pending", "completed", "failed"]
    integrations: Dict


class Index(CommonDBModel):
    organization: Union[PyObjectId, Organization]
    dataSources: List[str]
    stats: Optional[dict] = None
    state: IndexState


class Plan(CommonDBModel):
    name: str
    fields: List[PyObjectId]
    values: dict


class PlanField(CommonDBModel):
    name: str
    code: str
    kind: str
    initialValue: Union[int, bool, str]
    granularity: str
    canExceedLimit: Optional[bool]
    resetMode: Optional[str] = "manual"


class PlanState(CommonDBModel):
    plan: Union[PyObjectId, Plan]
    organization: Union[PyObjectId, Organization]
    state: dict
