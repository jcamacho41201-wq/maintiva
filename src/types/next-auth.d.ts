import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      shopId: string;
      shopName: string;
      role: string;
    };
  }

  interface User {
    shopId: string;
    shopName: string;
    role: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    shopId?: string;
    shopName?: string;
    role?: string;
  }
}
