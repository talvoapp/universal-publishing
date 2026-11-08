package utils

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// AppError is a typed error that maps to a specific HTTP status.
// All handlers should return AppError (or wrap one) so that the error
// middleware can serialize a consistent RFC 7807 response.
type AppError struct {
	Status int    `json:"-"`
	Code   string `json:"code"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
	// Extra holds additional fields merged into the response body.
	Extra map[string]any `json:"extra,omitempty"`
	// Err is the underlying cause (never serialized).
	Err error `json:"-"`
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Detail, e.Err)
	}
	return e.Detail
}

func (e *AppError) Unwrap() error { return e.Err }

// Write serializes the AppError as an RFC 7807 response.
// The `instance` field is the request ID, injected by the middleware.
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

func ValidationFailed(detail string, fields []FieldError) *AppError {
	return &AppError{
		Status: http.StatusBadRequest,
		Code:   "VALIDATION_ERROR",
		Title:  "Bad Request",
		Detail: detail,
		Extra:  map[string]any{"errors": fields},
	}
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

func Conflict(detail, code string) *AppError {
	return &AppError{Status: http.StatusConflict, Code: code, Title: "Conflict", Detail: detail}
}

func TooManyRequests(detail, code string) *AppError {
	return &AppError{Status: http.StatusTooManyRequests, Code: code, Title: "Too Many Requests", Detail: detail}
}

func Internal(detail string, err error) *AppError {
	return &AppError{
		Status: http.StatusInternalServerError,
		Code:   "INTERNAL_ERROR",
		Title:  "Internal Server Error",
		Detail: detail,
		Err:    err,
	}
}

func ServiceUnavailable(detail, code string) *AppError {
	return &AppError{Status: http.StatusServiceUnavailable, Code: code, Title: "Service Unavailable", Detail: detail}
}

// FieldError describes a single field-level validation error.
type FieldError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
	Code    string `json:"code"`
}

// AsAppError returns err as *AppError, or wraps unknown errors as 500.
func AsAppError(err error) *AppError {
	var appErr *AppError
	if errors.As(err, &appErr) {
		return appErr
	}
	return Internal("An unexpected error occurred", err)
}