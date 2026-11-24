<?php

use App\Database\RetryingMySqlConnector;

it('retries only connects refused for load', function () {
    expect(RetryingMySqlConnector::isRefusedForLoad(new PDOException('SQLSTATE[HY000] [2002] Connection refused')))->toBeTrue()
        ->and(RetryingMySqlConnector::isRefusedForLoad(new PDOException('SQLSTATE[HY000] [1040] Too many connections')))->toBeTrue()
        ->and(RetryingMySqlConnector::isRefusedForLoad(new PDOException("SQLSTATE[42000] [1203] User has exceeded the 'max_user_connections' resource")))->toBeTrue()
        ->and(RetryingMySqlConnector::isRefusedForLoad(new PDOException("SQLSTATE[HY000] [1045] Access denied for user 'x'@'localhost'")))->toBeFalse()
        ->and(RetryingMySqlConnector::isRefusedForLoad(new PDOException("SQLSTATE[HY000] [1049] Unknown database 'x'")))->toBeFalse();
});

it('is the connector Laravel uses for mysql', function () {
    expect(app('db.connector.mysql'))->toBeInstanceOf(RetryingMySqlConnector::class)
        ->and(array_sum(RetryingMySqlConnector::PAUSES_MS))->toBeLessThan(2000);
});
