CREATE TABLE IF NOT EXISTS `artifact_quiz_results` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `visitor_name` VARCHAR(191) NULL,
    `answers` TEXT NOT NULL,
    `matched_artifact` VARCHAR(191) NOT NULL,
    `ai_explanation` LONGTEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `artifact_quiz_results_created_at_idx`(`created_at`),
    INDEX `artifact_quiz_results_matched_artifact_idx`(`matched_artifact`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
