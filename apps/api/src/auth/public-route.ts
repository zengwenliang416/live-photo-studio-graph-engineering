import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ROUTE_METADATA = "live-photo-studio:public-route";

export const PublicRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE_METADATA, true);
