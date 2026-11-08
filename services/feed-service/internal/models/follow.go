package models

import (
	"time"
)

// FollowStatus is the state of a follow relationship.
type FollowStatus string

const (
	FollowStatusActive   FollowStatus = "active"
	FollowStatusBlocked  FollowStatus = "blocked" // user blocked the other
	FollowStatusPending  FollowStatus = "pending" // for private accounts (v2)
)

// Follow is one row in the `follows` table.
type Follow struct {
	FollowerID string       `json:"followerId"`
	FolloweeID string       `json:"followeeId"`
	Status     FollowStatus `json:"status"`
	CreatedAt  time.Time    `json:"createdAt"`
}

// FollowUserSummary is a lightweight user profile in follow listings.
type FollowUserSummary struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName,omitempty"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
	FollowedAt  time.Time `json:"followedAt"`
}