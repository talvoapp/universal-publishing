package utils

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// AppError is a typed error that maps to a specific HTTP status.
type AppError struct {
	Status int            `json:"-"`
	Code   string         `json:"code"`
	Title  string         `json:"title"`
	Detail string         `json:"detail"`
	Extra  map[string]any `json:"extra,omitempty"`
	Err    error          `json:"-"`
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Detail, e.Err)
	}
	return e.Detail
}

func (e *AppError) Unwrap() error { return e.Err }

// Write serializes the AppError as an RFC 7807 response.
func (e *AppError) Write(w http.ResponseWriter, requestID string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(e.Status)
	body := map[string]any{
		"type":     fmt.Sprintf("https://httpstatuses.io/%d", e.Status),
		"title":    e.Title,
		"status":   e.Status,
		"detail":   e.Detail,
		"code":     e.Code,
		"instance": requestID,
	}
	for k, v := range e.Extra {
		body[k] = v
	}
	_ = json.NewEncoder(w).Encode(body)
}

// ------------------------------------------------------------
// Constructors
// ------------------------------------------------------------
func BadRequest(detail, code string) *AppError {
	return &AppError{Status: http.StatusBadRequest, Code: code, Title: "Bad Request", Detail: detail}
}

func Unauthorized(detail, code string) *AppError {
	return &AppError{Status: http.StatusUnauthorized, Code: code, Title: "Unauthorized", Detail: detail}
}

func Forbidden(detail, code string) *AppError {
	return &AppError{Status: http.StatusForbidden, Code: code, Title: "Forbidden", Detail: detail}
}

func NotFound(detail, code string) *AppError {
	return &AppError{Status: http.StatusNotFound, Code: code, Title: "Not Found", Detail: detail}
}

// EntitlementRequired returns a 403 with a purchase prompt payload.
// This is the response when a user requests content they don't own.
func EntitlementRequired(itemID, chapterID string, priceCents int64, currency string) *AppError {
	return &AppError{
		Status: http.StatusForbidden,
		Code:   "ENTITLEMENT_REQUIRED",
		Title:  "Forbidden",
		Detail: "You need to purchase this content to access it",
		Extra: map[string]any{
			"itemId":     itemID,
			"chapterId":  chapterID,
			"priceCents": priceCents,
			"currency":   currency,
			"purchaseUrl": "/market/checkout",
		},
	}
}

func Internal(detail string, err error) *AppError {
	return &AppError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Title: "Internal Server Error", Detail: detail, Err: err}
}

func ServiceUnavailable(detail, code string) *AppError {
	return &AppError{Status: http.StatusServiceUnavailable, Code: code, Title: "Service Unavailable", Detail: detail}
}

// AsAppError returns err as *AppError, or wraps unknown errors as 500.
func AsAppError(err error) *AppError {
	var appErr *AppError
	if errors.As(err, &appErr) {
		return appErr
	}
	return Internal("An unexpected error occurred", err)
}