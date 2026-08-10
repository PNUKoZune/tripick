import { MigrationInterface, QueryRunner } from "typeorm";

export class InitEntities1785135565704 implements MigrationInterface {
    name = 'InitEntities1785135565704'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "withdrawal_reasons" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reason" character varying, "detail" text, "accountAgeDays" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_59da4be223ccb64e472180a5f49" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "kakaoId" character varying, "email" character varying, "handle" character varying, "passwordHash" character varying, "pendingPasswordHash" character varying, "emailVerifiedAt" TIMESTAMP WITH TIME ZONE, "isDemo" boolean NOT NULL DEFAULT false, "nickname" character varying NOT NULL, "profileImageUrl" character varying, "notificationPreferences" jsonb NOT NULL DEFAULT '{"replan_ready":true,"weather_alert":true,"crowd_alert":true,"arrival_alert":true,"trip_reminder":true,"trip_invite":true,"schedule_change_request":true,"schedule_change_result":true,"general":true,"friend_request":true}'::jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3b143f780fcd3f057f4e12862a" ON "users" ("kakaoId") WHERE "kakaoId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e2dd77cb8a46c78d8ea34de039" ON "users" ("email") WHERE "email" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1696ad337de0bca45e52a78b22" ON "users" ("handle") WHERE "handle" IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE "trips" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "title" character varying NOT NULL, "destination" character varying NOT NULL, "startDate" date NOT NULL, "endDate" date NOT NULL, "status" character varying NOT NULL DEFAULT 'draft', "sleepTime" character varying, "wakeTime" character varying, "transportMode" character varying NOT NULL DEFAULT 'transit', "notes" text, "shareToken" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_c42efc7b8ebdf904fbdd1c7e942" UNIQUE ("shareToken"), CONSTRAINT "PK_f71c231dee9c05a9522f9e840f5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "trip_days" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "day" integer NOT NULL, "region" character varying NOT NULL, "sortOrder" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_050b16d50cf830df078e0ad0efb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0534e3742e454adcf4090c7b16" ON "trip_days" ("tripId", "day") `);
        await queryRunner.query(`CREATE TABLE "trip_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "userId" uuid, "friendId" uuid, "nickname" character varying NOT NULL, "contact" character varying, "kakaoId" character varying, "relation" character varying, "role" character varying NOT NULL DEFAULT 'companion', "status" character varying NOT NULL DEFAULT 'pending', "color" character varying NOT NULL DEFAULT '#3182F6', "preferenceTags" jsonb NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d0368bd704fcb6883af326d8285" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "schedule_change_proposals" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "requesterId" uuid NOT NULL, "kind" character varying NOT NULL, "payload" jsonb NOT NULL, "summary" text NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "day" integer, "targetItemId" character varying, "resolvedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c9ce389592b91145489ab2a8f2c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_923b912b40df5eb84cd4f525d3" ON "schedule_change_proposals" ("requesterId", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_7c74eb3e3b0214ba6c1e164226" ON "schedule_change_proposals" ("tripId", "status") `);
        await queryRunner.query(`CREATE TABLE "preferences" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "tasteTags" jsonb NOT NULL DEFAULT '{}', "profile" jsonb NOT NULL DEFAULT '{}', "photoUrls" jsonb NOT NULL DEFAULT '[]', "photoTags" jsonb NOT NULL DEFAULT '{}', "disabledPhotoTags" jsonb NOT NULL DEFAULT '{}', "embeddingId" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_eb2de5fbaa61832e982f53d9716" UNIQUE ("userId"), CONSTRAINT "REL_eb2de5fbaa61832e982f53d971" UNIQUE ("userId"), CONSTRAINT "PK_17f8855e4145192bbabd91a51be" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "fcm_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "token" character varying NOT NULL, "platform" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0802a779d616597e9330bb9a7cc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_642d4f7ba5c6e019c2d8f5332a" ON "fcm_tokens" ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_639c0f1d38d97d778122d4f299" ON "fcm_tokens" ("token") `);
        await queryRunner.query(`CREATE TABLE "itinerary_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "day" integer NOT NULL, "order" integer NOT NULL, "type" character varying NOT NULL, "name" character varying NOT NULL, "address" character varying NOT NULL, "coordinates" jsonb NOT NULL, "scheduledAt" TIMESTAMP WITH TIME ZONE NOT NULL, "durationMin" integer NOT NULL, "travelTimeMin" integer, "openingHours" character varying, "phoneNumber" character varying, "kakaoPlaceId" character varying, "imageUrl" character varying, "memo" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f37a39ff959ce329ccbb0d98e24" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "category" character varying NOT NULL, "title" character varying NOT NULL, "body" text NOT NULL, "payload" jsonb, "readAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_21e65af2f4f242d4c85a92aff4" ON "notifications" ("userId", "createdAt") `);
        await queryRunner.query(`CREATE TABLE "friends" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ownerId" uuid NOT NULL, "friendUserId" uuid, "nickname" character varying NOT NULL, "handle" character varying NOT NULL, "color" character varying NOT NULL DEFAULT '#3182F6', "initial" character varying NOT NULL, "emoji" character varying, "statusMessage" character varying, "status" character varying NOT NULL DEFAULT 'accepted', "pinned" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_65e1b06a9f379ee5255054021e1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_417fcaa7d8ada782795fd04bd1" ON "friends" ("ownerId", "handle") `);
        await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "tokenHash" character varying NOT NULL, "familyId" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "replacedAt" TIMESTAMP WITH TIME ZONE, "revokedAt" TIMESTAMP WITH TIME ZONE, "userAgent" character varying, "ipAddress" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_610102b60fea1455310ccd299d" ON "refresh_tokens" ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c25bc63d248ca90e8dcc1d92d0" ON "refresh_tokens" ("tokenHash") `);
        await queryRunner.query(`CREATE INDEX "IDX_40e9a8b923a1b3fb4429a5c624" ON "refresh_tokens" ("familyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_070d648bde98d061fd6e9d176d" ON "refresh_tokens" ("userId", "revokedAt") `);
        await queryRunner.query(`CREATE TABLE "email_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "purpose" character varying(32) NOT NULL, "tokenHash" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "consumedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_08abb3fa348e894c274a6730d35" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0a5e6c81093655b770eabd0460" ON "email_tokens" ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3c9d0517a29ae032a37e258d51" ON "email_tokens" ("tokenHash") `);
        await queryRunner.query(`ALTER TABLE "trips" ADD CONSTRAINT "FK_db768456df45322f8a749534322" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trip_days" ADD CONSTRAINT "FK_4d54c6e08a229ef4a31d6fa0c74" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trip_members" ADD CONSTRAINT "FK_a39c25218bf1f1ac2d657d66b93" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trip_members" ADD CONSTRAINT "FK_b7bea805243e6121b267df4af5a" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "schedule_change_proposals" ADD CONSTRAINT "FK_781de7fcc1dec4939d59ad9c488" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "schedule_change_proposals" ADD CONSTRAINT "FK_3034714719d93c8b3ec156aaaa3" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "preferences" ADD CONSTRAINT "FK_eb2de5fbaa61832e982f53d9716" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "itinerary_items" ADD CONSTRAINT "FK_073602b13349c8bb6b31fb57067" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_692a909ee0fa9383e7859f9b406" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "friends" ADD CONSTRAINT "FK_c56c071c05d04b3ddb88c390b8b" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "friends" ADD CONSTRAINT "FK_22726dabf1591b833c92bd14a36" FOREIGN KEY ("friendUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "friends" DROP CONSTRAINT "FK_22726dabf1591b833c92bd14a36"`);
        await queryRunner.query(`ALTER TABLE "friends" DROP CONSTRAINT "FK_c56c071c05d04b3ddb88c390b8b"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "FK_692a909ee0fa9383e7859f9b406"`);
        await queryRunner.query(`ALTER TABLE "itinerary_items" DROP CONSTRAINT "FK_073602b13349c8bb6b31fb57067"`);
        await queryRunner.query(`ALTER TABLE "preferences" DROP CONSTRAINT "FK_eb2de5fbaa61832e982f53d9716"`);
        await queryRunner.query(`ALTER TABLE "schedule_change_proposals" DROP CONSTRAINT "FK_3034714719d93c8b3ec156aaaa3"`);
        await queryRunner.query(`ALTER TABLE "schedule_change_proposals" DROP CONSTRAINT "FK_781de7fcc1dec4939d59ad9c488"`);
        await queryRunner.query(`ALTER TABLE "trip_members" DROP CONSTRAINT "FK_b7bea805243e6121b267df4af5a"`);
        await queryRunner.query(`ALTER TABLE "trip_members" DROP CONSTRAINT "FK_a39c25218bf1f1ac2d657d66b93"`);
        await queryRunner.query(`ALTER TABLE "trip_days" DROP CONSTRAINT "FK_4d54c6e08a229ef4a31d6fa0c74"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP CONSTRAINT "FK_db768456df45322f8a749534322"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3c9d0517a29ae032a37e258d51"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0a5e6c81093655b770eabd0460"`);
        await queryRunner.query(`DROP TABLE "email_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_070d648bde98d061fd6e9d176d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_40e9a8b923a1b3fb4429a5c624"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c25bc63d248ca90e8dcc1d92d0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_610102b60fea1455310ccd299d"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_417fcaa7d8ada782795fd04bd1"`);
        await queryRunner.query(`DROP TABLE "friends"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_21e65af2f4f242d4c85a92aff4"`);
        await queryRunner.query(`DROP TABLE "notifications"`);
        await queryRunner.query(`DROP TABLE "itinerary_items"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_639c0f1d38d97d778122d4f299"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_642d4f7ba5c6e019c2d8f5332a"`);
        await queryRunner.query(`DROP TABLE "fcm_tokens"`);
        await queryRunner.query(`DROP TABLE "preferences"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7c74eb3e3b0214ba6c1e164226"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_923b912b40df5eb84cd4f525d3"`);
        await queryRunner.query(`DROP TABLE "schedule_change_proposals"`);
        await queryRunner.query(`DROP TABLE "trip_members"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0534e3742e454adcf4090c7b16"`);
        await queryRunner.query(`DROP TABLE "trip_days"`);
        await queryRunner.query(`DROP TABLE "trips"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1696ad337de0bca45e52a78b22"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e2dd77cb8a46c78d8ea34de039"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3b143f780fcd3f057f4e12862a"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TABLE "withdrawal_reasons"`);
    }

}
