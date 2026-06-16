export type SubscriptionType = 'max' | 'pro' | 'enterprise' | 'team' | string
export type RateLimitTier = string
export type BillingType = string

export type OAuthProfileResponse = {
  account?: {
    uuid?: string
    email?: string
    email_address?: string
    display_name?: string
    created_at?: string
    [key: string]: any
  }
  organization?: {
    uuid?: string
    organization_type?: string
    rate_limit_tier?: RateLimitTier | null
    has_extra_usage_enabled?: boolean | null
    billing_type?: BillingType | null
    subscription_created_at?: string | null
    [key: string]: any
  }
  [key: string]: any
}

export type OAuthTokenExchangeResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
  account?: {
    uuid: string
    email_address: string
    [key: string]: any
  }
  organization?: {
    uuid: string
    [key: string]: any
  }
  [key: string]: any
}

export type OAuthTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  scopes?: string[]
  subscriptionType?: SubscriptionType | null
  rateLimitTier?: RateLimitTier | null
  profile?: OAuthProfileResponse
  tokenAccount?: {
    uuid: string
    emailAddress: string
    organizationUuid?: string
  }
  [key: string]: any
}

export type UserRolesResponse = {
  organization_role?: string
  workspace_role?: string
  organization_name?: string
  [key: string]: any
}

export type ReferralCampaign = string
export type ReferralEligibilityResponse = Record<string, any>
export type ReferralRedemptionsResponse = Record<string, any>
export type ReferrerRewardInfo = Record<string, any>
