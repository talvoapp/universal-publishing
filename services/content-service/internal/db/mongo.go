package db

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// MongoDeps holds the Mongo client + database name for convenience.
type MongoDeps struct {
	Client   *mongo.Client
	Database string
}

// MongoCollection returns a collection handle from the configured DB.
func MongoCollection(client *mongo.Client, dbName, name string) *mongo.Collection {
	return client.Database(dbName).Collection(name)
}

// MongoHealthCheck returns true if Mongo is reachable.
func MongoHealthCheck(ctx context.Context, client *mongo.Client) bool {
	if client == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return client.Ping(ctx, nil) == nil
}

// FindOneMongo is a small helper that returns (doc, found, err).
// Simplifies common read patterns.
func FindOneMongo(
	ctx context.Context,
	coll *mongo.Collection,
	filter bson.M,
	out any,
) (bool, error) {
	err := coll.FindOne(ctx, filter).Decode(out)
	if err == mongo.ErrNoDocuments {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("mongo find_one: %w", err)
	}
	return true, nil
}