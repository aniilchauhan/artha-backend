import CredentialsProvider from "next-auth/providers/credentials";
import { authenticateAccount } from './authenticate';

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "you@domain.com" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        try {
          const user = await authenticateAccount(credentials?.email, credentials?.password);
          if (!user) return null;
          return user;
        } catch (err: any) {
          console.error('[NextAuth Authorize Error]:', err?.message || err);
          throw new Error(err?.message || 'Sign-in unavailable. Check your server configuration or credentials.');
        }
      }
    })
  ],
  trustHost: true,
  session: {
    strategy: "jwt" as const,
  },
  secret: process.env.NEXTAUTH_SECRET || 'axion-staging-production-auth-secret-key-32chars',
  pages: {
    signIn: "/auth",
  },
  callbacks: {
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.emailVerified = user.emailVerified;
      }
      return token;
    },
    async session({ session, token }: any) {
      if (token) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.emailVerified = token.emailVerified;
      }
      return session;
    }
  }
};
