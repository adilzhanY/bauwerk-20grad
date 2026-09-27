import { Inject, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthService, Unauthenticated } from "./auth.service";
import type { AuthUser } from "./auth.service";

const PUBLIC = "bauwerk:public";

/** A route anyone may call, signed in or not. */
export const Public = () => SetMetadata(PUBLIC, true);

/** The request as the guard leaves it: with the user when accounts are on. */
export type AuthedRequest = Request & { user?: AuthUser };

/** The token of a request: `Authorization: Bearer <token>`. */
export function bearer(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match?.[1];
}

/**
 * Every REST route needs a signed in user when accounts are on, except the ones marked
 * Public. With accounts off everything is open, as before accounts existed.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.auth.enabled) return true;
    // Nest runs global guards on socket messages too. A socket was checked once, when it
    // connected (the gateway's middleware), and has no HTTP headers to look at.
    if (context.getType() !== "http") return true;
    const open = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (open) return true;
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    try {
      request.user = await this.auth.verify(bearer(request.headers.authorization));
      return true;
    } catch (error) {
      if (error instanceof Unauthenticated) throw new UnauthorizedException({ error: "signIn" });
      throw error;
    }
  }
}
