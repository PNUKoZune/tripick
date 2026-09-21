import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexTripAccessAndItinerary1788762000000 implements MigrationInterface {
  name = 'IndexTripAccessAndItinerary1788762000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX "IDX_trips_user_created" ON trips ("userId", "createdAt")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_trip_members_user_status_trip" ON trip_members ("userId", status, "tripId")',
    );
    await queryRunner.query('CREATE INDEX "IDX_trip_members_trip" ON trip_members ("tripId")');
    await queryRunner.query(
      'CREATE INDEX "IDX_itinerary_trip_day_order" ON itinerary_items ("tripId", day, "order")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of [
      'IDX_itinerary_trip_day_order',
      'IDX_trip_members_trip',
      'IDX_trip_members_user_status_trip',
      'IDX_trips_user_created',
    ]) {
      await queryRunner.query(`DROP INDEX "${name}"`);
    }
  }
}
