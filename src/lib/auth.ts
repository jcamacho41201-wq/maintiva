import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { demoShop, demoUsers } from "@/lib/demo-data";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = demoUsers.find((item) => item.email === parsed.data.email);
        if (!user || parsed.data.password !== "demo-password") return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          shopId: user.shopId,
          shopName: demoShop.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.shopId = (user as typeof user & { shopId: string }).shopId;
        token.shopName = (user as typeof user & { shopName: string }).shopName;
        token.role = (user as typeof user & { role: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...session.user,
        shopId: token.shopId as string,
        shopName: token.shopName as string,
        role: token.role as string,
      };
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};

export function requireShopScope(session: { user?: { shopId?: string } } | null) {
  if (!session?.user?.shopId) {
    throw new Error("Authenticated shop scope is required.");
  }

  return session.user.shopId;
}
