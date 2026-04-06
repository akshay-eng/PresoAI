import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { compare } from "bcryptjs";
import { prisma } from "@slideforge/db";

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  pages: {
    signIn: "/auth/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        const isValid = await compare(password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
    ...(process.env.MICROSOFT_CLIENT_ID
      ? [
          MicrosoftEntraID({
            clientId: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
            issuer: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || "common"}/v2.0`,
          } as Parameters<typeof MicrosoftEntraID>[0]),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.userId = user.id;
        token.role = (user as { role?: string }).role || "USER";
      }

      if (account && account.provider !== "credentials") {
        const existingUser = await prisma.user.findUnique({
          where: { email: token.email! },
        });

        if (existingUser) {
          token.userId = existingUser.id;
          token.role = existingUser.role;

          await prisma.oAuthAccount.upsert({
            where: {
              provider_providerAccountId: {
                provider: account.provider,
                providerAccountId: account.providerAccountId!,
              },
            },
            update: {
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              expiresAt: account.expires_at
                ? new Date(account.expires_at * 1000)
                : null,
              scope: account.scope,
            },
            create: {
              userId: existingUser.id,
              provider: account.provider,
              providerAccountId: account.providerAccountId!,
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              expiresAt: account.expires_at
                ? new Date(account.expires_at * 1000)
                : null,
              scope: account.scope,
            },
          });
        } else {
          const newUser = await prisma.user.create({
            data: {
              email: token.email!,
              name: token.name,
            },
          });
          token.userId = newUser.id;
          token.role = newUser.role;

          await prisma.oAuthAccount.create({
            data: {
              userId: newUser.id,
              provider: account.provider,
              providerAccountId: account.providerAccountId!,
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              expiresAt: account.expires_at
                ? new Date(account.expires_at * 1000)
                : null,
              scope: account.scope,
            },
          });
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as unknown as { id: string }).id = token.userId as string;
        (session.user as unknown as { role: string }).role = token.role as string;
      }
      return session;
    },
  },
});

export async function getRequiredSession() {
  const session = await auth();
  if (!session?.user || !(session.user as { id?: string }).id) {
    throw new Error("Unauthorized");
  }
  return session as typeof session & {
    user: { id: string; role: string; email: string; name: string };
  };
}
